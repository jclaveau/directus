import config, { paths, type Env } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepCallback,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { writeExtensionPackage } from '@utils/write-extension-package';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import {
	startFakeProviders,
	type MollieHolding,
	type ReceivedWrite,
	type StripeHolding,
} from './subscription-fake-providers';
import {
	sendRows,
	withKeys,
	type Row,
	type ScenarioKeys,
} from './singular-write-steps';

type OwnPlanSubscriber = {
	id: number;
	provider: string;
	customer: string;
	reference: string;
	plan_status: string;
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

const STRIPE_WEBHOOK_SECRET = 'whsec_blackbox';

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

const lifecycleFeature = loadFeature(
	'./tests/db/routes/system/subscription-lifecycle.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const vendorEnv: Env = cloneDeep(config.envs)[vendor]!;

	const scenarioKeys: ScenarioKeys = {
		run: randomUUID(),
		keysByName: {},
	};

	let database: Knex;
	let fakeProviders: Awaited<ReturnType<typeof startFakeProviders>>;
	let instanceProcess: ChildProcess;
	let packageDirectory: string;

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
			unansweredPaths: fakeProviders.unansweredPaths,
		};
	}

	beforeAll(async () => {
		database = knex(config.knexConfig[vendor]!);

		fakeProviders = await startFakeProviders();

		packageDirectory = await mkdtemp(join(tmpdir(), 'directus-blackbox-bundle-'));

		await writeExtensionPackage(packageDirectory, {
			'@scalabus/subscriptions': BUNDLE_DIRECTORY,
		});

		const reroutePreload = pathToFileURL(
			join(paths.cwd, 'setup', 'reroute-provider-apis.mjs'),
		);

		const instancePort = await freePortOfWorker();

		Object.assign(vendorEnv, {
			PORT: String(instancePort),
			PUBLIC_URL: `http://127.0.0.1:${instancePort}`,
			PACKAGE_FILE_LOCATION: packageDirectory,
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_blackbox',
			SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_blackbox',
			SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
			BLACKBOX_PROVIDERS_PORT: String(fakeProviders.listeningPort),
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
			.whereIn('version', [
				'@scalabus/subscriptions:20261105A',
				'@scalabus/subscriptions:20261107A',
			])
			.delete();

		await database('directus_presets')
			.where('collection', 'subscription_sync_queue')
			.delete();

		await database('directus_collections')
			.where('collection', 'subscription_sync_queue')
			.delete();

		// Deleting a user or a policy takes its access rows along.
		await database('directus_users')
			.whereIn('email', [
				'subscribed@example.com',
				'no-access@example.com',
				'refused@example.com',
			])
			.orWhere('email', 'like', 'lifecycle-%@example.com')
			.delete();

		await database('directus_policies')
			.whereIn('name', ['Pro plan', 'Other policy', 'Direct policy'])
			.orWhere('name', 'like', 'Lifecycle %')
			.delete();

		await database.destroy();

		await fakeProviders.stopListening();

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

	// A table too wide for a row per line.
	function seedColumnRow(
		tableName: string,
		columnsTable: { column: string; value: string }[],
	) {
		return seedRows(tableName, [
			Object.fromEntries(columnsTable.map(({ column, value }) => {
				return [column, value];
			})),
		]);
	}

	// Everything held stays held, so an hourly reconcile falling in a later
	// scenario finds its answer.
	function holdSubscription(rowsTable: Record<string, string>[]) {
		expect(rowsTable).toHaveLength(1);

		fakeProviders.holdAtMollie(
			parseGherkinTable<MollieHolding>(rowsTable)[0]!,
		);
	}

	function holdStripeSubscription(rowsTable: Record<string, string>[]) {
		expect(rowsTable).toHaveLength(1);

		fakeProviders.holdAtStripe(
			parseGherkinTable<StripeHolding>(rowsTable)[0]!,
		);
	}

	function forgetSubscription(subscriptionId: string) {
		fakeProviders.forgetSubscription(subscriptionId);
	}

	async function seedOwnPlanSubscribers(rowsTable: Record<string, string>[]) {
		for (const ownPlan of parseGherkinTable<OwnPlanSubscriber>(rowsTable)) {
			const { id: seedId, provider, customer } = ownPlan;
			const seededPolicy = withKeys(`<policy_${seedId}>`, scenarioKeys);
			const seededUser = withKeys(`<user_${seedId}>`, scenarioKeys);

			await database('directus_policies').insert({
				id: seededPolicy,
				name: `Lifecycle ${seedId}`,
			});

			await database('directus_users').insert({
				id: seededUser,
				email: `lifecycle-${seedId}@example.com`,
				token: `lifecycle-${seedId}-token`,
			});

			await database('subscribers').insert({ id: seedId, user: seededUser });

			await database('subscriber_customers').insert({
				id: seedId,
				subscriber: seedId,
				provider,
				provider_customer_id: customer,
			});

			await database('subscription_plans').insert({
				id: seedId,
				code: `plan-${seedId}`,
				name: `Plan ${seedId}`,
				policy: seededPolicy,
				amount: 1000,
				currency: 'EUR',
				interval: 'month',
				status: ownPlan.plan_status,
			});

			await database('subscription_plan_references').insert({
				id: seedId,
				plan: seedId,
				provider,
				reference: ownPlan.reference,
			});
		}
	}

	// Signed like Stripe, which `sendRows` cannot do: the signature covers the
	// exact bytes and the time they are sent at.
	async function sendStripeEvents(
		rowsTable: { type: string; subscription: string }[],
	) {
		for (const { type: eventType, subscription } of rowsTable) {
			const eventBody = JSON.stringify({
				id: 'evt_blackbox',
				object: 'event',
				type: eventType,
				data: { object: { id: subscription, object: 'subscription' } },
			});

			const signedAt = Math.floor(Date.now() / 1000);

			const eventSignature = createHmac('sha256', STRIPE_WEBHOOK_SECRET)
				.update(`${signedAt}.${eventBody}`)
				.digest('hex');

			const stripeResponse = await fetch(
				`${vendorEnv['PUBLIC_URL']}/subscriptions/webhooks/stripe`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Stripe-Signature': `t=${signedAt},v1=${eventSignature}`,
					},
					body: eventBody,
				},
			);

			expect(stripeResponse.status).toBe(200);
		}
	}

	// A database hands a date back in its own type: JSON reads it as the table does.
	async function readStoredRows(
		rowsQuery: Knex.QueryBuilder,
		withSyncErrors: boolean,
	) {
		return {
			storedRows: JSON.parse(JSON.stringify(await rowsQuery)),
			syncErrors: withSyncErrors
				? await database('subscription_sync_queue')
					.select('last_error')
					.whereNotNull('last_error')
				: [],
			unansweredPaths: fakeProviders.unansweredPaths,
		};
	}

	function expectEventualRows(
		readRowsQuery: () => Knex.QueryBuilder,
		expectedRows: unknown[],
		withSyncErrors = true,
	) {
		return expect.poll(() => {
			return readStoredRows(readRowsQuery(), withSyncErrors);
		}, SYNC_POLL)
			.toEqual({
				storedRows: expectedRows,
				syncErrors: [],
				unansweredPaths: [],
			});
	}

	function readExpectedRows<ExpectedRow extends Record<string, unknown>>(
		rowsTable: Record<string, string>[],
	) {
		return parseGherkinTable<ExpectedRow>(
			JSON.parse(withKeys(JSON.stringify(rowsTable), scenarioKeys)),
		);
	}

	function expectStoredSubscription(
		subscriptionId: string,
		rowsTable: Record<string, string>[],
	) {
		return expectEventualRows(
			() => {
				return database('subscriptions')
					.select(Object.keys(rowsTable[0]!))
					.where('provider_subscription_id', subscriptionId);
			},
			readExpectedRows(rowsTable),
		);
	}

	function expectSubscriptionEvents(
		subscriptionId: string,
		rowsTable: Record<string, string>[],
	) {
		return expectEventualRows(
			() => {
				return database('subscription_events')
					.join(
						'subscriptions',
						'subscriptions.id',
						'subscription_events.subscription',
					)
					.select(Object.keys(rowsTable[0]!).map((columnName) => {
						return `subscription_events.${columnName}`;
					}))
					.where('subscriptions.provider_subscription_id', subscriptionId)
					.orderBy('subscription_events.id');
			},
			readExpectedRows(rowsTable),
		);
	}

	// Without the sync errors: the row may well hold the error being asserted.
	function expectQueueRows(rowsTable: Record<string, string>[]) {
		const expectedRows = readExpectedRows<{ resource_id: string }>(rowsTable);

		return expectEventualRows(
			() => {
				return database('subscription_sync_queue')
					.select(Object.keys(rowsTable[0]!))
					.whereIn(
						'resource_id',
						expectedRows.map((expectedRow) => {
							return expectedRow.resource_id;
						}),
					)
					.orderBy('resource_id');
			},
			expectedRows,
			false,
		);
	}

	function expectNoQueueRow(resourceId: string) {
		return expectEventualRows(
			() => {
				return database('subscription_sync_queue')
					.select('resource_id')
					.where('resource_id', resourceId);
			},
			[],
		);
	}

	async function expectReceivedWrites(rowsTable: Record<string, string>[]) {
		await expect.poll(() => {
			return fakeProviders.receivedWrites;
		}, SYNC_POLL)
			.toEqual(parseGherkinTable<ReceivedWrite>(rowsTable));

		fakeProviders.receivedWrites.length = 0;
	}

	function sendRequestRows(rowsTable: Row[]) {
		return sendRows(
			{
				vendor,
				instanceUrl: () => vendorEnv['PUBLIC_URL']!,
				scenarioKeys,
			},
			rowsTable,
			false,
		);
	}

	async function expectStoredAccess(rowsTable: Record<string, string>[]) {
		expect(rowsTable).toHaveLength(1);

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
		expect(rowsTable).toHaveLength(1);

		const [{ user: grantedUser }] = parseGherkinTable<{ user: string }>(
			JSON.parse(withKeys(JSON.stringify(rowsTable), scenarioKeys)),
		) as [{ user: string }];

		await expect.poll(() => readSyncState(grantedUser), SYNC_POLL)
			.toEqual({ accessRows: [], syncErrors: [], unansweredPaths: [] });
	}

	defineFeature(accessFeature, (scenario) => {
		scenario(accessFeature.scenarios[0]!.title, ({ given, when, then, and }) => {
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

		scenario(accessFeature.scenarios[1]!.title, ({ given, then, and }) => {
			given(/^the rows of (\w+):$/, seedRows);
			and(/^the rows of (\w+):$/, seedRows);
			and(/^the rows of (\w+):$/, seedRows);
			and(/^the rows of (\w+):$/, seedRows);
			and(/^the rows of (\w+):$/, seedRows);
			and(/^the rows of (\w+):$/, seedRows);
			and(/^this row of (\w+):$/, seedColumnRow);
			then('these requests get these responses:', sendRequestRows);
		}, 60_000);
	});

	const lifecycleSteps: [RegExp, StepCallback][] = [
		[/^these subscribers, each with its own plan:$/, seedOwnPlanSubscribers],
		[/^the rows of (\w+):$/, seedRows],
		[/^Mollie holds this subscription:$/, holdSubscription],
		[/^Stripe holds this subscription:$/, holdStripeSubscription],
		[/^(?:Mollie|Stripe) no longer holds subscription (\w+)$/, forgetSubscription],
		[/^these requests get these responses:$/, sendRequestRows],
		[/^Stripe sends these events:$/, sendStripeEvents],
		[/^this access is eventually stored:$/, expectStoredAccess],
		[/^this user eventually holds no access:$/, expectNoAccess],
		[/^subscription (\w+) is eventually stored:$/, expectStoredSubscription],
		[/^the events of subscription (\w+) are eventually:$/, expectSubscriptionEvents],
		[/^these sync queue rows are eventually stored:$/, expectQueueRows],
		[/^the sync queue eventually holds no row for (\S+)$/, expectNoQueueRow],
		[/^the providers eventually received these writes:$/, expectReceivedWrites],
	];

	// Bound off each scenario's own steps: the library binds by position.
	defineFeature(lifecycleFeature, (scenario) => {
		for (const { title, steps: scenarioSteps } of lifecycleFeature.scenarios) {
			scenario(title, ({ defineStep }) => {
				for (const { stepText } of scenarioSteps) {
					const boundStep = lifecycleSteps.find(([stepMatcher]) => {
						return stepMatcher.test(stepText);
					});

					if (boundStep === undefined) {
						throw new Error(`No step reads ${JSON.stringify(stepText)}`);
					}

					defineStep(...boundStep);
				}
			}, 180_000);
		}
	});
});
