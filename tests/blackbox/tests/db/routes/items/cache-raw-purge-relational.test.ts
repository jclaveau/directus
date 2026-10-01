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

// The two collections extensions/cache-raw-purge raw-writes on /relational: it
// takes no collection name, so this file creates them under the names it hard-codes.
const ACCOUNT = 'rawpurge_account';
const ENTRY = 'rawpurge_entry';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-raw-purge-relational.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-rawpurge-rel-${vendor}`;

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
			],
		});

		// The m2o must exist before `entry` can scope by `account.owner`, so set the
		// relational scope field only after the field is created.
		await CreateFieldM2O(vendor, {
			collection: ENTRY,
			field: 'account',
			otherCollection: ACCOUNT,
		});

		await request(getUrl(vendor, env))
			.patch(`/collections/${ENTRY}`)
			.send({ meta: { scoped_cache_fields: ['account.owner'] } })
			.set('Authorization', auth);

		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: ENTRY });
		await DeleteCollection(vendor, { collection: ACCOUNT });
	});

	// A `query` cell holds the `Query` the read is made of: `fields` and `sort`
	// go as lists, anything nested as JSON, which Directus parses natively.
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
			'a raw write to one owner\'s entries purges that owner\'s reads only',
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
					'the endpoint raw-writes the "target" entries and purges them, keys '
						+ 'included:',
					async (table: Record<string, string>[]) => {
						const mutated = await request(getUrl(vendor, env))
							.post('/cache-raw-purge/relational')
							.send({ owner: table[0]!['owner'] })
							.set('Authorization', auth);

						expect(mutated.statusCode).toBe(200);

						expect(mutated.body).toEqual({
							entries: Number(table[0]!['entries']),
						});
					},
				);

				then(
					'target_1 is purged, as its entries sit in the owner the written rows '
						+ 'resolve to:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'MISS');
					},
				);

				and(
					'witness_1 is still cached, as no written row resolves to its owner:',
					(table: Record<string, string>[]) => {
						return expectAnswer(ENTRY, table, 'HIT');
					},
				);
			},
			60_000,
		);
	});
});
