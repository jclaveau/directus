import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep, omit } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

// The two collections extensions/cache-raw-purge raw-writes: it takes no
// collection name, so this file creates them under the names it hard-codes.
const RAW_DOCUMENT = 'rawpurge_document';
const RAW_LINE = 'rawpurge_document_line';
const BATCH_PATCH = 'home_pin_batch_patch';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-primary-key-home-pin.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-primary-key-home-pin-${vendor}`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;

	const indexPrefix = `${namespace}:scoped-cache-index:fingerprint:`;
	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		// Scoped on `owner`, so a write reads its rows back: the scope fields rank
		// after the key, which leads the home pin fields of every collection.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: RAW_DOCUMENT,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'revision', type: 'integer', meta: {} },
					],
				},
				{
					collection: RAW_LINE,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'revision', type: 'integer', meta: {} },
					],
				},
				{
					collection: BATCH_PATCH,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
			],
		});

		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();

		await DeleteCollection(vendor, { collection: RAW_DOCUMENT });
		await DeleteCollection(vendor, { collection: RAW_LINE });
		await DeleteCollection(vendor, { collection: BATCH_PATCH });
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

	async function expectCachedUnderHomePins(
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

			for (const homePinSet of loadYaml(row['home pin sets']!) as string[]) {
				expect(await redisClient.exists(
					`${indexPrefix}${collection}:${homePinSet}`,
				)).toBe(1);
			}
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
			'purgeForMutatedRows with the rows\' keys purges the read pinning that key',
			({ given, and, when, then }) => {
				given(
					`these rows of ${RAW_DOCUMENT}:`,
					(table: Record<string, string>[]) => {
						return createRows(RAW_DOCUMENT, table);
					},
				);

				and(
					'these reads are cached, each filed under the home pin sets of its keys:',
					(table: Record<string, string>[]) => {
						return expectCachedUnderHomePins(RAW_DOCUMENT, table);
					},
				);

				when(
					'the endpoint raw-writes the "target" rows and purges them, keys '
						+ 'included:',
					async (table: Record<string, string>[]) => {
						const mutated = await request(getUrl(vendor, env))
							.post('/cache-raw-purge/')
							.send({ owner: table[0]!['owner'] })
							.set('Authorization', auth);

						expect(mutated.statusCode).toBe(200);

						expect(mutated.body).toEqual({
							documents: Number(table[0]!['documents']),
							lines: Number(table[0]!['lines']),
						});
					},
				);

				then(
					'target_1 is purged, as it pins "id" to 3, the key the purged row '
						+ 'carries:',
					(table: Record<string, string>[]) => {
						return expectAnswer(RAW_DOCUMENT, table, 'MISS');
					},
				);

				and(
					'witness_1 is still cached, as it pins "id" to 4, a key no purged row '
						+ 'carries:',
					(table: Record<string, string>[]) => {
						return expectAnswer(RAW_DOCUMENT, table, 'HIT');
					},
				);
			},
			60_000,
		);

		scenario(
			'a batch PATCH naming each row\'s key purges the read pinning that key',
			({ given, and, when, then }) => {
				given(
					`these rows of ${BATCH_PATCH}:`,
					(table: Record<string, string>[]) => {
						return createRows(BATCH_PATCH, table);
					},
				);

				and(
					'these reads are cached, each filed under the home pin sets of its keys:',
					(table: Record<string, string>[]) => {
						return expectCachedUnderHomePins(BATCH_PATCH, table);
					},
				);

				when(
					'the rows are written in one batch PATCH, each naming its key:',
					async (table: Record<string, string>[]) => {
						const updated = await request(getUrl(vendor, env))
							.patch(`/items/${BATCH_PATCH}`)
							.send(loadYaml(table[0]!['body']!) as object)
							.set('Authorization', auth);

						expect(updated.statusCode).toBe(200);
					},
				);

				then(
					'target_1 is purged, as it pins "id" to 2, the key the written row '
						+ 'carries:',
					(table: Record<string, string>[]) => {
						return expectAnswer(BATCH_PATCH, table, 'MISS');
					},
				);

				and(
					'witness_1 is still cached, as it pins "id" to 5, not the "owner" it '
						+ 'shares:',
					(table: Record<string, string>[]) => {
						return expectAnswer(BATCH_PATCH, table, 'HIT');
					},
				);
			},
			60_000,
		);
	});
});
