import config, { getUrl, paths, type Env } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { writeExtensionPackage } from '@utils/write-extension-package';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import {
	sendRows,
	withKeys,
	type Row,
	type ScenarioKeys,
} from './singular-write-steps';

type HeldSubscription = {
	payment: string;
	customer: string;
	subscription: string;
	plan_reference: string;
	status: string;
};

type StoredAccess = { user: string; policy: string; managed_by: string };

const BUNDLE_DIRECTORY = join(
	paths.cwd,
	'..',
	'..',
	'packages',
	'core-extensions',
	'subscriptions',
);

// The sync runs every 10 seconds, after a boot that may still be settling.
const SYNC_POLL = { timeout: 45_000, interval: 500 };

const BUNDLE_TABLES = [
	'subscription_sync_queue',
	'subscription_events',
	'subscriptions',
	'subscription_plan_references',
	'subscription_plans',
	'subscriber_customers',
	'subscribers',
];

const accessFeature = loadFeature(
	'./tests/db/routes/system/subscription-managed-access.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const vendorEnv: Env = cloneDeep(config.envs)[vendor]!;

	const scenarioKeys: ScenarioKeys = {
		run: randomUUID(),
		keysByName: {},
	};

	const fakeMollie: {
		heldSubscription?: HeldSubscription;
		unansweredPaths: string[];
	} = { unansweredPaths: [] };

	let database: Knex;
	let fakeMollieServer: Server;
	let instanceProcess: ChildProcess;
	let packageDirectory: string;

	function answerAsMollie(requestPath: string): object | undefined {
		const heldSubscription = fakeMollie.heldSubscription;

		if (heldSubscription === undefined) {
			return undefined;
		}

		const { payment, customer, subscription } = heldSubscription;

		if (requestPath === `/v2/payments/${payment}`) {
			return {
				resource: 'payment',
				id: payment,
				customerId: customer,
				subscriptionId: subscription,
			};
		}

		if (requestPath === `/v2/customers/${customer}/subscriptions/${subscription}`) {
			return {
				resource: 'subscription',
				id: subscription,
				customerId: customer,
				status: heldSubscription.status,
				interval: '1 month',
				nextPaymentDate: '2099-01-01',
				metadata: { plan: heldSubscription.plan_reference },
			};
		}

		return undefined;
	}

	// A sync error stays in its queue row: reading it with the rows puts it in
	// the failure's diff, as does a call the fake Mollie has no answer for.
	async function readSyncState(grantedUser: string) {
		return {
			accessRows: await database('directus_access')
				.select('user', 'policy', 'managed_by')
				.where('user', grantedUser),
			syncErrors: await database('subscription_sync_queue')
				.select('last_error')
				.whereNotNull('last_error'),
			unansweredPaths: fakeMollie.unansweredPaths,
		};
	}

	beforeAll(async () => {
		database = knex(config.knexConfig[vendor]!);

		fakeMollieServer = createServer((mollieRequest, mollieResponse) => {
			const requestPath = new URL(mollieRequest.url!, 'http://mollie').pathname;
			const mollieAnswer = answerAsMollie(requestPath);

			if (mollieAnswer === undefined) {
				fakeMollie.unansweredPaths.push(requestPath);
				mollieResponse.writeHead(500);
				mollieResponse.end();

				return;
			}

			mollieResponse.writeHead(200, {
				'Content-Type': 'application/hal+json',
			});

			mollieResponse.end(JSON.stringify(mollieAnswer));
		});

		await new Promise<void>((resolveListen) => {
			fakeMollieServer.listen(0, '127.0.0.1', resolveListen);
		});

		packageDirectory = await mkdtemp(join(tmpdir(), 'directus-blackbox-bundle-'));

		await writeExtensionPackage(packageDirectory, {
			'@scalabus/subscriptions': BUNDLE_DIRECTORY,
		});

		const reroutePreload = pathToFileURL(
			join(paths.cwd, 'setup', 'reroute-mollie-api.mjs'),
		);

		const instancePort = await freePortOfWorker();

		Object.assign(vendorEnv, {
			PORT: String(instancePort),
			PUBLIC_URL: `http://127.0.0.1:${instancePort}`,
			PACKAGE_FILE_LOCATION: packageDirectory,
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_blackbox',
			BLACKBOX_MOLLIE_PORT: String(
				(fakeMollieServer.address() as AddressInfo).port,
			),
			NODE_OPTIONS: [vendorEnv['NODE_OPTIONS'], `--import=${reroutePreload}`]
				.filter(Boolean)
				.join(' '),
		});

		const bootstrapRun = spawnSync('node', [paths.cli, 'bootstrap'], {
			cwd: paths.cwd,
			env: vendorEnv,
		});

		if (bootstrapRun.status !== 0) {
			throw new Error(
				`The bootstrap exited with ${JSON.stringify(bootstrapRun.status)}:`
				+ ` ${JSON.stringify(bootstrapRun.stderr.toString())}`,
			);
		}

		instanceProcess = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: vendorEnv,
		});

		await awaitDirectusConnection(instancePort);
	}, 180_000);

	afterAll(async () => {
		await stopSpawnedInstance(instanceProcess);

		for (const bundleTable of BUNDLE_TABLES) {
			await database.schema.dropTableIfExists(bundleTable);
		}

		await database('directus_migrations')
			.where('version', '@scalabus/subscriptions:20261105A')
			.delete();

		// Deleting a user or a policy takes its access rows along.
		await database('directus_users')
			.whereIn('email', ['subscribed@example.com', 'no-access@example.com'])
			.delete();

		await database('directus_policies')
			.whereIn('name', ['Pro plan', 'Other policy'])
			.delete();

		await database.destroy();

		await new Promise((resolveClose) => {
			fakeMollieServer.close(resolveClose);
		});

		await rm(packageDirectory, { recursive: true, force: true });
	}, 60_000);

	function seedRows(tableName: string, rowsTable: Record<string, string>[]) {
		return database(tableName).insert(
			parseGherkinTable(JSON.parse(withKeys(
				JSON.stringify(rowsTable),
				scenarioKeys,
			))),
		);
	}

	function holdSubscription(rowsTable: Record<string, string>[]) {
		fakeMollie.heldSubscription = parseGherkinTable<HeldSubscription>(
			rowsTable,
		)[0];
	}

	function sendRequestRows(rowsTable: Row[]) {
		return sendRows(
			{
				vendor,
				instanceUrl: () => getUrl(vendor, vendorEnv),
				scenarioKeys,
			},
			rowsTable,
			false,
		);
	}

	async function expectStoredAccess(rowsTable: Record<string, string>[]) {
		const storedAccess = parseGherkinTable<StoredAccess>(JSON.parse(withKeys(
			JSON.stringify(rowsTable),
			scenarioKeys,
		)))[0]!;

		await expect.poll(() => readSyncState(storedAccess.user), SYNC_POLL)
			.toEqual({
				accessRows: [storedAccess],
				syncErrors: [],
				unansweredPaths: [],
			});

		const grantedRow = await database('directus_access')
			.first('id')
			.where('user', storedAccess.user);

		scenarioKeys.keysByName['granted_access'] = grantedRow.id;
	}

	async function expectNoAccess(rowsTable: Record<string, string>[]) {
		const [{ user: grantedUser }] = parseGherkinTable<{ user: string }>(
			JSON.parse(withKeys(JSON.stringify(rowsTable), scenarioKeys)),
		) as [{ user: string }];

		await expect.poll(() => readSyncState(grantedUser), SYNC_POLL)
			.toEqual({ accessRows: [], syncErrors: [], unansweredPaths: [] });
	}

	defineFeature(accessFeature, (scenario) => {
		for (const { title } of accessFeature.scenarios) {
			scenario(title, ({ given, when, then, and }) => {
				given(/^the rows of (\w+):$/, seedRows);
				and(/^the rows of (\w+):$/, seedRows);
				and(/^the rows of (\w+):$/, seedRows);
				and(/^the rows of (\w+):$/, seedRows);
				and(/^the rows of (\w+):$/, seedRows);
				and(/^the rows of (\w+):$/, seedRows);
				and('Mollie holds this subscription:', holdSubscription);
				when('these requests get these responses:', sendRequestRows);
				then('this access is eventually stored:', expectStoredAccess);
				and('these requests get these responses:', sendRequestRows);
				when('Mollie holds this subscription:', holdSubscription);
				and('these requests get these responses:', sendRequestRows);
				then('this user eventually holds no access:', expectNoAccess);
			}, 180_000);
		}
	});
});
