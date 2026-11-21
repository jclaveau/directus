import config, { paths, type Env } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	messageOfDocString,
	parseGherkinTable,
	responseCellOf,
	type StepCallback,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { writeExtensionPackage } from '@utils/write-extension-package';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import knex, { type Knex } from 'knex';
import { load as loadYaml } from 'js-yaml';
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
	type MollieMandate,
	type ReceivedWrite,
	type StripeHolding,
} from './subscription-fake-providers';
import {
	sendRows,
	withKeys,
	type Row,
	type ScenarioKeys,
} from './singular-write-steps';

type PendingSubscriptionSeed = {
	id: number;
	provider: string;
	manager: number;
	beneficiaries_max: number;
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

const MOLLIE_WEBHOOK_SECRET = 'mollie_secret_blackbox';

// Listed after the current one, as while a rotated secret still signs.
const MOLLIE_OLD_WEBHOOK_SECRET = 'mollie_secret_old';

// The sync runs every 10 seconds, after a boot that may still be settling.
const SYNC_POLL = { timeout: 45_000, interval: 500 };

const BUNDLE_TABLES = [
	'subscription_sync_queue',
	'subscription_events',
	'subscription_beneficiaries',
	'subscription_managers',
	'subscriptions',
	'subscription_plans',
];

// The users the features write, as `<prefix>-<id>@example.com` with an `id`
// from 100 to 199.
const SCENARIO_EMAIL_PREFIXES = [
	'payer',
	'friend',
	'invited',
	'other',
	'user',
	'co',
];

// The checkout pages the fake providers answer, the row id appended.
const CHECKOUT_PAGES = {
	mollie_page: 'https://www.mollie.com/checkout/tr_checkout_',
	stripe_page: 'https://checkout.stripe.com/c/pay/cs_checkout_',
};

// The names a scenario learns from a response: each scenario learns its own.
const RESPONSE_KEY_NAMES = ['checkout'];

const accessFeature = loadFeature(
	'./tests/db/routes/system/subscription-managed-access.feature',
);

const lifecycleFeature = loadFeature(
	'./tests/db/routes/system/subscription-lifecycle.feature',
);

const mineFeature = loadFeature(
	'./tests/db/routes/system/subscription-mine.feature',
);

const checkoutFeature = loadFeature(
	'./tests/db/routes/system/subscription-checkout.feature',
);

const schemaApplyFeature = loadFeature(
	'./tests/db/routes/system/subscription-schema-apply.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const vendorEnv: Env = cloneDeep(config.envs)[vendor]!;

	const scenarioKeys: ScenarioKeys = {
		run: randomUUID(),
		keysByName: { ...CHECKOUT_PAGES },
	};

	let database: Knex;
	let fakeProviders: Awaited<ReturnType<typeof startFakeProviders>>;
	let instanceProcess: ChildProcess;
	let packageDirectory: string;

	// Each `msg` the instance logged, raw: a line that is no JSON is kept whole.
	const loggedMessages: string[] = [];

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
			'subscriptions-synced-listener': join(
				paths.cwd,
				'extensions',
				'subscriptions-synced-listener',
			),
		});

		const reroutePreload = pathToFileURL(
			join(paths.cwd, 'setup', 'reroute-provider-apis.mjs'),
		);

		const instancePort = await freePortOfWorker();

		Object.assign(vendorEnv, {
			PORT: String(instancePort),
			PUBLIC_URL: `http://127.0.0.1:${instancePort}`,
			PACKAGE_FILE_LOCATION: packageDirectory,
			LOG_STYLE: 'raw',
			// The scenarios read warn and info lines: the default 'error' hides them.
			LOG_LEVEL: vendorEnv['LOG_LEVEL'] === 'error'
				? 'info'
				: vendorEnv['LOG_LEVEL'],
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_blackbox',
			SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS:
				`${MOLLIE_WEBHOOK_SECRET},${MOLLIE_OLD_WEBHOOK_SECRET}`,
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

		let unendedLogLine = '';

		instanceProcess.stdout!.on('data', (logChunk) => {
			const logLines = `${unendedLogLine}${String(logChunk)}`.split('\n');
			unendedLogLine = logLines.pop()!;

			for (const logLine of logLines) {
				loggedMessages.push(readLogMessage(logLine));
			}
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
				'@scalabus/subscriptions:20261121A',
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
			.orWhere((scenarioEmails) => {
				for (const emailPrefix of SCENARIO_EMAIL_PREFIXES) {
					scenarioEmails.orWhere(
						'email',
						'like',
						`${emailPrefix}-1__@example.com`,
					);
				}
			})
			.delete();

		await database('directus_policies')
			.whereIn('name', ['Pro plan', 'Other policy', 'Direct policy'])
			.orWhere('name', 'like', 'Lifecycle %')
			.orWhere('name', 'like', 'Mine %')
			.orWhere('name', 'like', 'Checkout %')
			.delete();

		await database.destroy();

		await fakeProviders.stopListening();

		await rm(packageDirectory, { recursive: true, force: true });
	}, 60_000);

	// A `subscriptions` row stating no dates is seeded at the time it is written.
	function seedRows(tableName: string, rowsTable: Record<string, string>[]) {
		const seededRows = parseGherkinTable(JSON.parse(withKeys(
			JSON.stringify(rowsTable),
			scenarioKeys,
		)));

		if (tableName !== 'subscriptions') {
			return database(tableName).insert(seededRows);
		}

		const seededAt = new Date();

		return database(tableName).insert(seededRows.map((seededRow) => {
			return { date_created: seededAt, date_updated: seededAt, ...seededRow };
		}));
	}

	// A table too wide for a row per line.
	type ColumnValueRow = { column: string; value: string };

	function readColumnRow(columnsTable: ColumnValueRow[]) {
		return Object.fromEntries(columnsTable.map(({ column, value }) => {
			return [column, withKeys(value, scenarioKeys)];
		}));
	}

	function seedColumnRow(
		tableName: string,
		columnsTable: ColumnValueRow[],
	) {
		return seedRows(tableName, [readColumnRow(columnsTable)]);
	}

	// Everything held stays held, so an hourly reconcile falling in a later
	// scenario finds its answer.
	function holdSubscription(columnsTable: ColumnValueRow[]) {
		fakeProviders.holdAtMollie(
			parseGherkinTable<MollieHolding>([readColumnRow(columnsTable)])[0]!,
		);
	}

	function holdFirstPayment(columnsTable: ColumnValueRow[]) {
		fakeProviders.holdFirstPaymentAtMollie(
			parseGherkinTable<MollieHolding>([readColumnRow(columnsTable)])[0]!,
		);
	}

	function holdMandate(columnsTable: ColumnValueRow[]) {
		fakeProviders.holdMandateAtMollie(
			parseGherkinTable<MollieMandate>([readColumnRow(columnsTable)])[0]!,
		);
	}

	function holdStripeSubscription(columnsTable: ColumnValueRow[]) {
		fakeProviders.holdAtStripe(
			parseGherkinTable<StripeHolding>([readColumnRow(columnsTable)])[0]!,
		);
	}

	function forgetSubscription(subscriptionId: string) {
		fakeProviders.forgetSubscription(subscriptionId);
	}

	// The providers of the scenario's pending subscriptions: a table holding a
	// column or rows per provider is read for the one provider found there.
	let scenarioProviders: string[] = [];

	function readScenarioProvider(): string {
		if (scenarioProviders.length !== 1) {
			throw new Error(
				'A table per provider is read for the one provider of the'
				+ ' scenario\'s pending subscriptions, which seeded'
				+ ` ${JSON.stringify(scenarioProviders)}`,
			);
		}

		return scenarioProviders[0]!;
	}

	// `| column | mollie | stripe |`: an empty cell leaves its row out.
	function readProviderColumn(
		providerTable: Record<string, string>[],
	): ColumnValueRow[] {
		const scenarioProvider = readScenarioProvider();

		if (!(scenarioProvider in providerTable[0]!)) {
			throw new Error(
				`This table holds no column for ${JSON.stringify(scenarioProvider)}:`
				+ ` ${JSON.stringify(Object.keys(providerTable[0]!))}`,
			);
		}

		return providerTable
			.filter((providerRow) => providerRow[scenarioProvider] !== '')
			.map((providerRow) => {
				return {
					column: providerRow['column']!,
					value: providerRow[scenarioProvider]!,
				};
			});
	}

	// A table with a `provider` column keeps the rows of the scenario's provider,
	// and any other table is kept whole.
	function keepProviderRows<TableRow extends Record<string, string>>(
		rowsTable: TableRow[],
	): TableRow[] {
		if (!('provider' in rowsTable[0]!)) {
			return rowsTable;
		}

		const scenarioProvider = readScenarioProvider();

		const providerRows = rowsTable
			.filter((tableRow) => tableRow['provider'] === scenarioProvider)
			.map(({ provider: _provider, ...keptCells }) => keptCells as TableRow);

		if (providerRows.length === 0) {
			throw new Error(
				`This table holds no row for ${JSON.stringify(scenarioProvider)}:`
				+ ` ${JSON.stringify(rowsTable)}`,
			);
		}

		return providerRows;
	}

	function holdProviderSubscription(providerTable: Record<string, string>[]) {
		const columnsTable = readProviderColumn(providerTable);
		const scenarioProvider = readScenarioProvider();

		if (scenarioProvider === 'mollie') {
			return holdSubscription(columnsTable);
		}

		if (scenarioProvider === 'stripe') {
			return holdStripeSubscription(columnsTable);
		}

		throw new Error(
			`No fake provider holds a subscription for`
			+ ` ${JSON.stringify(scenarioProvider)}`,
		);
	}

	// An expiry event tells of a checkout the fake provider then holds expired.
	function sendProviderEvents(
		rowsTable: { provider: string; type: string; entity: string }[],
	) {
		const providerRows = keepProviderRows(rowsTable);
		const scenarioProvider = readScenarioProvider();

		for (const { type: eventType, entity } of providerRows) {
			if (eventType === 'payment.expired') {
				fakeProviders.expirePaymentAtMollie(withKeys(entity, scenarioKeys));
			}

			if (eventType === 'checkout.session.expired') {
				fakeProviders.expireSessionAtStripe(withKeys(entity, scenarioKeys));
			}
		}

		if (scenarioProvider === 'mollie') {
			return sendMollieEvents(providerRows);
		}

		if (scenarioProvider === 'stripe') {
			return sendStripeEvents(providerRows.map(({ type, entity }) => {
				return { type, subscription: entity };
			}));
		}

		throw new Error(
			`No fake provider sends events for ${JSON.stringify(scenarioProvider)}`,
		);
	}

	async function seedPendingSubscriptions(rowsTable: Record<string, string>[]) {
		const seededRows = parseGherkinTable<PendingSubscriptionSeed>(rowsTable);

		scenarioProviders = [...new Set(seededRows.map((pendingSeed) => {
			return pendingSeed.provider;
		}))];

		for (const pendingSeed of seededRows) {
			const { id: seedId, manager: managerSeed } = pendingSeed;
			const seededPolicy = withKeys(`<policy_${seedId}>`, scenarioKeys);
			const seededManager = withKeys(`<user_${managerSeed}>`, scenarioKeys);
			const seededAt = new Date();

			await database('directus_policies').insert({
				id: seededPolicy,
				name: `Lifecycle ${seedId}`,
			});

			// A manager of several subscriptions is seeded with the first.
			if (managerSeed === seedId) {
				await database('directus_users').insert({
					id: seededManager,
					email: `lifecycle-${seedId}@example.com`,
					token: `lifecycle-${seedId}-token`,
				});
			}

			await database('subscription_plans').insert({
				id: seedId,
				code: `plan-${seedId}`,
				name: `Plan ${seedId}`,
				policy: seededPolicy,
				amount: 10,
				currency: 'EUR',
				interval: '{"months":1}',
				beneficiaries_max: pendingSeed.beneficiaries_max,
				status: pendingSeed.plan_status,
			});

			await database('subscriptions').insert({
				id: seedId,
				plan: seedId,
				provider: pendingSeed.provider,
				status: 'pending',
				date_created: seededAt,
				date_updated: seededAt,
			});

			await database('subscription_managers').insert({
				subscription: seedId,
				user: seededManager,
			});

			await database('subscription_beneficiaries').insert({
				subscription: seedId,
				user: seededManager,
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
				data: {
					object: {
						id: withKeys(subscription, scenarioKeys),
						object: eventType.startsWith('checkout.session.')
							? 'checkout.session'
							: 'subscription',
					},
				},
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

	// Signed like Mollie's next-gen webhook, which `sendRows` cannot do: the
	// signature covers the exact bytes sent.
	async function sendMollieEvents(
		rowsTable: { type: string; entity: string }[],
	) {
		for (const { type: eventType, entity } of rowsTable) {
			const eventBody = JSON.stringify({
				resource: 'event',
				id: 'event_blackbox',
				type: eventType,
				...entity === ''
					? {}
					: { entityId: withKeys(entity, scenarioKeys) },
			});

			const eventSignature = createHmac('sha256', MOLLIE_WEBHOOK_SECRET)
				.update(eventBody)
				.digest('hex');

			const mollieResponse = await fetch(
				`${vendorEnv['PUBLIC_URL']}/subscriptions/webhooks/mollie`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Mollie-Signature': `sha256=${eventSignature}`,
					},
					body: eventBody,
				},
			);

			expect(mollieResponse.status).toBe(200);
		}
	}

	// The event cell names the secret signing it, listed by the instance or not.
	async function sendSignedMollieEvents(
		rowsTable: { event: string; response: string }[],
	) {
		for (const { event: eventText, response: responseText } of rowsTable) {
			const { secret: signingSecret, ...eventFields } = cellOfKnownKeys<{
				secret: string;
				type: string;
				entityId: string;
			}>(
				'request',
				loadYaml(eventText),
				['secret', 'type', 'entityId'],
				'subscriptions-bundle.test.ts',
			);

			const expectedResponse = responseCellOf<object>(
				loadYaml(responseText),
				['code', 'body'],
				'subscriptions-bundle.test.ts',
			);

			const eventBody = JSON.stringify({
				resource: 'event',
				id: 'event_blackbox',
				...eventFields,
			});

			const eventSignature = createHmac('sha256', signingSecret)
				.update(eventBody)
				.digest('hex');

			const mollieResponse = await fetch(
				`${vendorEnv['PUBLIC_URL']}/subscriptions/webhooks/mollie`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Mollie-Signature': `sha256=${eventSignature}`,
					},
					body: eventBody,
				},
			);

			const receivedText = await mollieResponse.text();

			expect({
				code: mollieResponse.status,
				body: receivedText === ''
					? undefined
					: JSON.parse(receivedText),
			}).toMatchObject(expectedResponse);
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
		const providerRows = keepProviderRows(rowsTable);

		return expectEventualRows(
			() => {
				return database('subscriptions')
					.select(Object.keys(providerRows[0]!))
					.where('provider_subscription_id', subscriptionId);
			},
			readExpectedRows(providerRows),
		);
	}

	// `continues` holds a row id, which a scenario cannot know up front.
	function expectContinuedSubscription(
		subscriptionId: string,
		continuedSubscriptionId: string,
	) {
		return expectEventualRows(
			() => {
				return database('subscriptions')
					.join(
						'subscriptions as continued_subscriptions',
						'continued_subscriptions.id',
						'subscriptions.continues',
					)
					.select('continued_subscriptions.provider_subscription_id')
					.where('subscriptions.provider_subscription_id', subscriptionId);
			},
			[{ provider_subscription_id: continuedSubscriptionId }],
		);
	}

	function expectBeneficiaries(
		subscriptionId: string,
		rowsTable: Record<string, string>[],
	) {
		return expectEventualRows(
			() => {
				return database('subscription_beneficiaries')
					.join(
						'subscriptions',
						'subscriptions.id',
						'subscription_beneficiaries.subscription',
					)
					.select(Object.keys(rowsTable[0]!).map((columnName) => {
						return `subscription_beneficiaries.${columnName}`;
					}))
					.where('subscriptions.provider_subscription_id', subscriptionId)
					.orderBy('subscription_beneficiaries.id');
			},
			readExpectedRows(rowsTable),
		);
	}

	// Hundreds of lines get logged and vitest prints an array past a few
	// items as `[ …(61) ]`: a failure names the last lines sharing the
	// expected message's first word, so it shows what came instead.
	async function expectLoggedMessage(loggedDocString: string) {
		const expectedMessage = withKeys(
			messageOfDocString(loggedDocString),
			scenarioKeys,
		);

		const leadingWord = expectedMessage.split(' ')[0]!;

		try {
			await expect.poll(() => loggedMessages, SYNC_POLL)
				.toContain(expectedMessage);
		}
		catch {
			const sameWordMessages = loggedMessages.filter((loggedMessage) => {
				return loggedMessage.startsWith(leadingWord);
			});

			throw new Error(
				`${JSON.stringify(expectedMessage)} was never logged; the last`
				+ ` ${JSON.stringify(leadingWord)} lines:`
				+ ` ${JSON.stringify(sameWordMessages.slice(-8), null, 2)}`,
			);
		}
	}

	function expectSubscriptionEvents(
		subscriptionId: string,
		rowsTable: Record<string, string>[],
	) {
		const providerRows = keepProviderRows(rowsTable);

		return expectEventualRows(
			() => {
				return database('subscription_events')
					.join(
						'subscriptions',
						'subscriptions.id',
						'subscription_events.subscription',
					)
					.select(Object.keys(providerRows[0]!).map((columnName) => {
						return `subscription_events.${columnName}`;
					}))
					.where('subscriptions.provider_subscription_id', subscriptionId)
					.orderBy('subscription_events.id');
			},
			readExpectedRows(providerRows),
		);
	}

	// Each body as the YAML of its JSON: a body that is no JSON fails the poll.
	function expectUnreadableWebhooks(webhooksDocString: string) {
		return expect.poll(async () => {
			const unreadableRows = await database('subscription_events')
				.select('payload')
				.where('source', 'webhook_unreadable')
				.orderBy('id');

			return unreadableRows.map((unreadableRow) => {
				return JSON.parse(unreadableRow.payload);
			});
		}, SYNC_POLL)
			.toEqual(loadYaml(webhooksDocString));
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

	function expectNoProviderQueueRow(
		rowsTable: { provider: string; resource_id: string }[],
	) {
		const providerRows = keepProviderRows(rowsTable);

		if (providerRows.length !== 1) {
			throw new Error(
				'Expected one resource for the scenario\'s provider, got'
				+ ` ${JSON.stringify(providerRows)}`,
			);
		}

		return expectNoQueueRow(withKeys(providerRows[0]!.resource_id, scenarioKeys));
	}

	// A `write` cell is the YAML of one write, a write without `body` having none.
	function readExpectedWrites(
		rowsTable: Record<string, string>[],
	): ReceivedWrite[] {
		const providerRows = keepProviderRows(rowsTable);

		if (!('write' in providerRows[0]!)) {
			return parseGherkinTable<ReceivedWrite>(
				JSON.parse(withKeys(JSON.stringify(providerRows), scenarioKeys)),
			);
		}

		return providerRows.map(({ write: writeYaml }) => {
			return {
				body: null,
				...loadYaml(withKeys(writeYaml!, scenarioKeys)) as object,
			} as ReceivedWrite;
		});
	}

	async function expectReceivedWrites(
		rowsTable: Record<string, string>[],
		keptPath?: string,
	) {
		await expect.poll(() => {
			return fakeProviders.receivedWrites
				.filter((receivedWrite) => {
					return keptPath === undefined || receivedWrite.path === keptPath;
				})
				.map(comparableWrite);
		}, SYNC_POLL)
			.toEqual(readExpectedWrites(rowsTable).map(comparableWrite));

		fakeProviders.receivedWrites.length = 0;
	}

	function expectNoWrite() {
		expect(fakeProviders.receivedWrites).toEqual([]);
	}

	// A subscription too wide for a row: one line per field of the JSON body.
	// The writes that came before it, such as its checkout's, are not read.
	async function expectCreatedSubscription(
		customerId: string,
		fieldsTable: { field: string; value: string }[],
	) {
		const subscriptionsPath = `/v2/customers/${
			withKeys(customerId, scenarioKeys)}/subscriptions`;

		await expectReceivedWrites(
			[{
				method: 'POST',
				path: subscriptionsPath,
				body: JSON.stringify(Object.fromEntries(
					parseGherkinTable(JSON.parse(withKeys(
						JSON.stringify(fieldsTable),
						scenarioKeys,
					))).map(({ field, value }) => {
						return [field, value];
					}),
				)),
			}],
			subscriptionsPath,
		);
	}

	// A checkout names the provider a table per provider is read for.
	function sendRequestRows(rowsTable: Row[]) {
		for (const { request: requestText } of rowsTable) {
			if (!requestText.includes('/subscriptions/checkout')) {
				continue;
			}

			const { payload: checkoutPayload } = loadYaml(requestText) as {
				payload?: { provider?: unknown };
			};

			if (typeof checkoutPayload?.provider === 'string') {
				scenarioProviders = [
					...new Set([...scenarioProviders, checkoutPayload.provider]),
				];
			}
		}

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

	let cliRun: ReturnType<typeof spawnSync> | undefined;

	function runCli(
		cliArguments: string,
		variablesTable: { variable: string; value: string }[],
	) {
		cliRun = spawnSync('node', [paths.cli, ...cliArguments.split(' ')], {
			cwd: paths.cwd,
			env: {
				...vendorEnv,
				...Object.fromEntries(variablesTable.map(({ variable, value }) => {
					return [variable, value];
				})),
			},
			timeout: 60_000,
		});
	}

	function expectCliExit(exitStatus: string, loggedDocString: string) {
		expect({
			status: cliRun?.status,
			messages: String(cliRun?.stdout)
				.split('\n')
				.map(readLogMessage),
		})
			.toEqual({
				status: Number(exitStatus),
				messages: expect.arrayContaining([
					messageOfDocString(loggedDocString),
				]),
			});
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
			when('Mollie sends these events:', sendMollieEvents);
			then('this access is eventually stored:', expectStoredAccess);
			and('these requests get these responses:', sendRequestRows);
			when('Mollie holds this subscription:', holdSubscription);
			and('Mollie sends these events:', sendMollieEvents);
			then('this user eventually holds no access:', expectNoAccess);
		}, 180_000);

		scenario(accessFeature.scenarios[1]!.title, ({ given, then, and }) => {
			given(/^the rows of (\w+):$/, seedRows);
			and(/^the rows of (\w+):$/, seedRows);
			and(/^the rows of (\w+):$/, seedRows);
			and(/^this row of (\w+):$/, seedColumnRow);
			and(/^the rows of (\w+):$/, seedRows);
			then('these requests get these responses:', sendRequestRows);
		}, 60_000);
	});

	const lifecycleSteps: [RegExp, StepCallback][] = [
		[
			/^these pending subscriptions, each with its own plan:$/,
			seedPendingSubscriptions,
		],
		[/^the rows of (\w+):$/, seedRows],
		[/^Mollie holds this subscription:$/, holdSubscription],
		[/^Mollie holds this mandate:$/, holdMandate],
		[/^Mollie holds this first payment:$/, holdFirstPayment],
		[/^Stripe holds this subscription:$/, holdStripeSubscription],
		[/^the provider holds this subscription:$/, holdProviderSubscription],
		[
			/^(?:Mollie|Stripe|the provider) no longer holds subscription (\S+)$/,
			forgetSubscription,
		],
		[/^these requests get these responses:$/, sendRequestRows],
		[/^Stripe sends these events:$/, sendStripeEvents],
		[/^Mollie sends these events:$/, sendMollieEvents],
		[/^the provider sends these events:$/, sendProviderEvents],
		[/^these Mollie events get these responses:$/, sendSignedMollieEvents],
		[/^this access is eventually stored:$/, expectStoredAccess],
		[/^this user eventually holds no access:$/, expectNoAccess],
		[/^subscription (\S+) is eventually stored:$/, expectStoredSubscription],
		[/^the events of subscription (\S+) are eventually:$/, expectSubscriptionEvents],
		[
			/^these unreadable webhooks are eventually stored:$/,
			expectUnreadableWebhooks,
		],
		[
			/^subscription (\S+) eventually continues (\S+)$/,
			expectContinuedSubscription,
		],
		[
			/^the beneficiaries of subscription (\S+) are eventually:$/,
			expectBeneficiaries,
		],
		[/^the instance eventually logged:$/, expectLoggedMessage],
		[/^these sync queue rows are eventually stored:$/, expectQueueRows],
		[
			/^the sync queue eventually holds no row for this resource:$/,
			expectNoProviderQueueRow,
		],
		[/^the sync queue eventually holds no row for (\S+)$/, expectNoQueueRow],
		[/^the providers eventually received these writes:$/, expectReceivedWrites],
		[/^the providers received no write$/, expectNoWrite],
		[
			/^Mollie eventually received this subscription for (\S+):$/,
			expectCreatedSubscription,
		],
		[/^the CLI runs (.+) with these variables:$/, runCli],
		[/^the CLI exited with (\d+), having logged:$/, expectCliExit],
	];

	type DiffEntry = { collection: string; diff: { kind: string }[] };

	let appliedDiff: Record<'collections' | 'fields' | 'relations', DiffEntry[]>
		| undefined;

	function sendAsAdmin(method: string, routePath: string, payload?: unknown) {
		return fetch(`${vendorEnv['PUBLIC_URL']}${routePath}`, {
			method,
			headers: {
				'Authorization': `Bearer ${USER.ADMIN.TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: payload === undefined
				? undefined
				: JSON.stringify(payload),
		});
	}

	// Another file moving the schema between the diff and the apply makes the
	// hash stale: the apply is then taken again from a fresh snapshot.
	async function applySnapshotWithout(droppedCollection: string) {
		for (let applyAttempt = 1; applyAttempt <= 3; applyAttempt++) {
			const snapshotResponse = await sendAsAdmin('GET', '/schema/snapshot');

			expect(snapshotResponse.status).toBe(200);

			const { data: fullSnapshot } = await snapshotResponse.json();

			const isKept = (snapshotEntry: { collection: string }) => {
				return snapshotEntry.collection !== droppedCollection;
			};

			const diffResponse = await sendAsAdmin('POST', '/schema/diff', {
				...fullSnapshot,
				collections: fullSnapshot.collections.filter(isKept),
				fields: fullSnapshot.fields.filter(isKept),
				relations: fullSnapshot.relations.filter(isKept),
			});

			expect(diffResponse.status).toBe(200);

			const { data: { hash: schemaHash, diff: fullDiff } } = await diffResponse
				.json();

			const isDropped = (diffEntry: DiffEntry) => !isKept(diffEntry);

			appliedDiff = {
				collections: fullDiff.collections.filter(isDropped),
				fields: fullDiff.fields.filter(isDropped),
				relations: fullDiff.relations.filter(isDropped),
			};

			const applyResponse = await sendAsAdmin('POST', '/schema/apply', {
				hash: schemaHash,
				diff: appliedDiff,
			});

			const applyBody = await applyResponse.text();

			if (applyResponse.status === 400 && applyBody.includes('hash')) {
				continue;
			}

			expect({ status: applyResponse.status, body: applyBody })
				.toEqual({ status: 204, body: '' });

			return;
		}

		throw new Error(
			`The schema moved during each of 3 applies without`
			+ ` ${JSON.stringify(droppedCollection)}`,
		);
	}

	function expectDeletedCollections(
		rowsTable: { collection: string; kind: string }[],
	) {
		expect(appliedDiff?.collections.map(({ collection, diff }) => {
			return { collection, kind: diff[0]?.kind };
		}))
			.toEqual(rowsTable);
	}

	async function expectNoTable(tableName: string) {
		expect(await database.schema.hasTable(tableName)).toBe(false);
	}

	// Bound off each scenario's own steps: the library binds by position. An
	// outline's steps still read `<column>`, which the library fills per example.
	function defineLifecycleFeature(
		stepsFeature: ReturnType<typeof loadFeature>,
	) {
		const lifecycleScenarios = [
			...stepsFeature.scenarios,
			...stepsFeature.scenarioOutlines,
		];

		defineFeature(stepsFeature, (scenario) => {
			for (const { title, steps: scenarioSteps } of lifecycleScenarios) {
				scenario(title, ({ defineStep }) => {
					for (const [stepIndex, { stepText }] of scenarioSteps.entries()) {
						const boundStep = lifecycleSteps.find(([stepMatcher]) => {
							return stepMatcher.test(stepText);
						});

						if (boundStep === undefined) {
							throw new Error(`No step reads ${JSON.stringify(stepText)}`);
						}

						const [stepMatcher, stepCallback] = boundStep;

						if (stepIndex > 0) {
							defineStep(stepMatcher, stepCallback);

							continue;
						}

						// A scenario seeding no pending subscription has no provider,
						// and reads only the writes it makes.
						defineStep(stepMatcher, (...stepArguments: unknown[]) => {
							scenarioProviders = [];
							fakeProviders.receivedWrites.length = 0;

							for (const responseKeyName of RESPONSE_KEY_NAMES) {
								delete scenarioKeys.keysByName[responseKeyName];
							}

							return stepCallback(...stepArguments);
						});
					}
				}, 180_000);
			}
		});
	}

	defineLifecycleFeature(lifecycleFeature);
	defineLifecycleFeature(mineFeature);
	defineLifecycleFeature(checkoutFeature);

	// Last: the apply drops the sync queue every scenario above relies on.
	defineFeature(schemaApplyFeature, (scenario) => {
		scenario(schemaApplyFeature.scenarios[0]!.title, ({ when, then, and }) => {
			when(
				/^the admin applies a snapshot of this instance without (\w+)$/,
				applySnapshotWithout,
			);

			then('the diff deletes these collections:', expectDeletedCollections);
			and(/^table (\w+) no longer exists$/, expectNoTable);
		}, 60_000);
	});
});

function readLogMessage(logLine: string): string {
	try {
		return JSON.parse(logLine).msg ?? logLine;
	}
	catch {
		return logLine;
	}
}

// A body as the fields it carries: Mollie's JSON parsed, Stripe's form decoded
// to the object its brackets nest, each leaf a string as the form sends it.
function comparableWrite(receivedWrite: ReceivedWrite): ReceivedWrite {
	const { path: writePath, body: writeBody } = receivedWrite;

	if (writeBody === null) {
		return receivedWrite;
	}

	if (writePath.startsWith('/v1/')) {
		return {
			...receivedWrite,
			body: typeof writeBody === 'string'
				? decodeStripeForm(writeBody)
				: stringifyLeaves(writeBody) as object,
		};
	}

	return {
		...receivedWrite,
		body: typeof writeBody === 'string'
			? JSON.parse(writeBody)
			: writeBody,
	};
}

function decodeStripeForm(formText: string): object {
	const decodedForm: Record<string, unknown> = {};

	for (const [fieldPath, fieldValue] of new URLSearchParams(formText)) {
		const pathSegments = fieldPath.replaceAll(']', '').split('[');
		let parentNode = decodedForm;

		for (const [segmentIndex, pathSegment] of pathSegments.entries()) {
			const nextSegment = pathSegments[segmentIndex + 1];

			if (nextSegment === undefined) {
				parentNode[pathSegment] = fieldValue;

				continue;
			}

			parentNode[pathSegment] ??= /^\d+$/.test(nextSegment)
				? []
				: {};

			parentNode = parentNode[pathSegment] as Record<string, unknown>;
		}
	}

	return decodedForm;
}

function stringifyLeaves(bodyNode: unknown): unknown {
	if (Array.isArray(bodyNode)) {
		return bodyNode.map(stringifyLeaves);
	}

	if (bodyNode !== null && typeof bodyNode === 'object') {
		return Object.fromEntries(
			Object.entries(bodyNode).map(([fieldName, fieldNode]) => {
				return [fieldName, stringifyLeaves(fieldNode)];
			}),
		);
	}

	return String(bodyNode);
}
