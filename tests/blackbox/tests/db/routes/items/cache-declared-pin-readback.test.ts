import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep, omit } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

// The names extensions/cache-declared-pin-readback hard-codes.
const ACCOUNT = 'readback_account';
const ENTRY = 'readback_entry';
const SIGNAL = 'readback_signal';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-declared-pin-readback.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-pin-readback-${vendor}`;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: ACCOUNT,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [{ field: 'owner', type: 'string', meta: {} }],
				},
				{
					collection: ENTRY,
					fields: [{ field: 'revision', type: 'integer', meta: {} }],
				},
				{
					collection: SIGNAL,
					fields: [
						{ field: 'rewritten_ids', type: 'json', meta: {} },
						{ field: 'rewritten_values', type: 'json', meta: {} },
						{ field: 'deleted_account', type: 'integer', meta: {} },
						{ field: 'declared', type: 'json', meta: {} },
					],
				},
			],
		});

		const { relation } = await CreateFieldM2O(vendor, {
			collection: ENTRY,
			field: 'account',
			otherCollection: ACCOUNT,
		});

		expect(relation).toMatchObject({ related_collection: ACCOUNT });

		// Scoped by the m2o, not by `account.owner`: a composed path is no index
		// path, so the purge would have no hop to read back.
		const scoped = await request(getUrl(vendor, env))
			.patch(`/collections/${ENTRY}`)
			.send({ meta: { scoped_cache_fields: ['account'] } })
			.set('Authorization', auth);

		expect(scoped.statusCode).toBe(200);

		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: SIGNAL });
		await DeleteCollection(vendor, { collection: ENTRY });
		await DeleteCollection(vendor, { collection: ACCOUNT });
	});

	// As in `cache-raw-purge-relational.test.ts`: `fields` and `sort` go as lists,
	// anything nested as JSON.
	function readItems(collection: string, query: string) {
		const parameters: Record<string, string | string[]> = {};
		const sentQuery = loadYaml(query) as Record<string, unknown>;

		for (const [parameter, value] of Object.entries(sentQuery)) {
			if (typeof value === 'string' || Array.isArray(value)) {
				parameters[parameter] = value;
			}
			else {
				parameters[parameter] = JSON.stringify(value);
			}
		}

		return request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query(parameters)
			.set('Authorization', auth);
	}

	async function createRows(
		collection: string,
		table: Record<string, string>[],
	) {
		const created = await request(getUrl(vendor, env))
			.post(`/items/${collection}`)
			.send(parseGherkinTable(table).map((row) => omit(row, 'markers')))
			.set('Authorization', auth);

		expect(created.statusCode).toBe(200);
	}

	async function createSignal(table: Record<string, string>[]) {
		const created = await request(getUrl(vendor, env))
			.post(`/items/${SIGNAL}`)
			.send(parseGherkinTable(table)[0])
			.set('Authorization', auth);

		expect(created.statusCode).toBe(200);
	}

	async function expectCached(
		collection: string,
		table: Record<string, string>[],
	) {
		for (const row of table) {
			expect((await readItems(collection, row['query']!))
				.headers[cacheStatusHeader]).toBe('MISS');

			// Polled: the reap the boot asks for can move the purge counter under
			// the first fill, which then evicts what it wrote.
			await expect.poll(async () => {
				return (await readItems(collection, row['query']!))
					.headers[cacheStatusHeader];
			}, { timeout: 5_000 }).toBe('HIT');

			const cached = await readItems(collection, row['query']!);

			expect(cached.headers[cacheStatusHeader]).toBe('HIT');
			expect(cached.body.data).toEqual(loadYaml(row['response']!));
		}
	}

	async function expectAnswer(
		collection: string,
		table: Record<string, string>[],
		cacheStatus: 'HIT' | 'MISS',
	) {
		for (const row of table) {
			const answered = await readItems(collection, row['query']!);

			expect(answered.headers[cacheStatusHeader]).toBe(cacheStatus);
			expect(answered.body.data).toEqual(loadYaml(row['response']!));
		}
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a pin on one account purges its owner\'s reads and spares another\'s',
			({ given, and, when, then }) => {
				given(
					`these rows of ${ACCOUNT}:`,
					(table: Record<string, string>[]) => {
						return createRows(ACCOUNT, table);
					},
				);

				and(
					`these rows of ${ENTRY}:`,
					(table: Record<string, string>[]) => {
						return createRows(ENTRY, table);
					},
				);

				and(
					'these reads are cached:',
					(table: Record<string, string>[]) => {
						return expectCached(ENTRY, table);
					},
				);

				when(
					'a signal rewrites the entries and declares:',
					(table: Record<string, string>[]) => {
						return createSignal(table);
					},
				);

				then(
					'target_1 is purged, as account 1 reaches its owner:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'MISS');
					},
				);

				and(
					'witness_1 is still cached, as account 1 does not reach its '
						+ 'owner:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'HIT');
					},
				);
			},
			60_000,
		);

		scenario(
			'pins on the account a row left and the one it joined purge both '
				+ 'owners',
			({ given, and, when, then }) => {
				given(
					`these rows of ${ACCOUNT}:`,
					(table: Record<string, string>[]) => {
						return createRows(ACCOUNT, table);
					},
				);

				and(
					`these rows of ${ENTRY}:`,
					(table: Record<string, string>[]) => {
						return createRows(ENTRY, table);
					},
				);

				and(
					'these reads are cached:',
					(table: Record<string, string>[]) => {
						return expectCached(ENTRY, table);
					},
				);

				when(
					'a signal moves entry 4 to account 4 and declares both '
						+ 'accounts:',
					(table: Record<string, string>[]) => {
						return createSignal(table);
					},
				);

				then(
					'both moved_2 reads are purged, as each account reaches one '
						+ 'owner:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'MISS');
					},
				);

				and(
					'witness_2 is still cached, as neither account reaches its '
						+ 'owner:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'HIT');
					},
				);
			},
			60_000,
		);

		scenario(
			'a pin on a deleted account purges every owner\'s reads',
			({ given, and, when, then }) => {
				given(
					`these rows of ${ACCOUNT}:`,
					(table: Record<string, string>[]) => {
						return createRows(ACCOUNT, table);
					},
				);

				and(
					`these rows of ${ENTRY}:`,
					(table: Record<string, string>[]) => {
						return createRows(ENTRY, table);
					},
				);

				and(
					'these reads are cached:',
					(table: Record<string, string>[]) => {
						return expectCached(ENTRY, table);
					},
				);

				when(
					'a signal deletes account 6 with its entries and declares it:',
					(table: Record<string, string>[]) => {
						return createSignal(table);
					},
				);

				then(
					'target_3 is purged, though account 6 is read back as no row:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'MISS');
					},
				);

				and(
					'witness_3 is purged too, as the purge read every owner\'s set:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'MISS');
					},
				);
			},
			60_000,
		);
	});
});
