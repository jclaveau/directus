import config, { paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { awaitRequestedReap } from '@utils/await-requested-reap';
import {
	countRedisCommands,
	joinBrokenKeys,
	monitorRedisCommands,
} from '@utils/monitor-redis-commands';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep, omit } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const ROW = 'purge_command_row';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-purge-redis-commands.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-purge-commands-${vendor}`;

	const namespace = env[vendor]['CACHE_NAMESPACE'];

	const redis = new Redis({
		host: env[vendor]['REDIS_HOST'],
		port: Number(env[vendor]['REDIS_PORT']),
	});

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess | undefined;
	let sentCommands: Record<string, string>[] = [];

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: ROW,
					meta: { scoped_cache_fields: ['owner', 'team'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'team', type: 'string', meta: {} },
						{ field: 'revision', type: 'integer', meta: {} },
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
		instance?.kill();

		for (const key of await redis.keys(`${namespace}*`)) {
			await redis.del(key);
		}

		await redis.quit();

		await DeleteCollection(vendor, { collection: ROW });
	});

	// Not `getUrl`: under TEST_LOCAL or TEST_NO_CACHE it points at another server,
	// one without this test's cache.
	function spawnedServerUrl() {
		return `http://127.0.0.1:${env[vendor].PORT}`;
	}

	// As in `cache-merged-purge.test.ts`: `fields` and `sort` go as lists, anything
	// nested as JSON.
	function readRows(query: string) {
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

		return request(spawnedServerUrl())
			.get(`/items/${ROW}`)
			.query(parameters)
			.set('Authorization', auth);
	}

	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, ({ given, and, when, then }) => {
				// Awaiting the reap the clear asks for: a pass running under a write
				// would add its own commands to the ones counted.
				given('the cache is cleared', async () => {
					await awaitRequestedReap(
						Number(env[vendor]['REDIS_PORT']),
						namespace!,
						async () => {
							await request(spawnedServerUrl())
								.post('/utils/cache/clear')
								.set('Authorization', auth);
						},
					);
				});

				given(
					`these rows of ${ROW}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(spawnedServerUrl())
							.post(`/items/${ROW}`)
							.send(
								parseGherkinTable(table)
									.map((row) => omit(row, 'markers')),
							)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				and(
					'these reads are cached:',
					async (table: Record<string, string>[]) => {
						for (const { query } of table) {
							expect((await readRows(query!)).headers[cacheStatusHeader])
								.toBe('MISS');

							expect((await readRows(query!)).headers[cacheStatusHeader])
								.toBe('HIT');
						}
					},
				);

				// One id goes to the route of one item, the way a client edits a row;
				// more go as one batch.
				when(
					'these rows are updated:',
					async (table: Record<string, string>[]) => {
						const { ids, values } = parseGherkinTable<{
							ids: number[];
							values: Record<string, unknown>;
						}>(table)[0]!;

						const monitoredCommands = await monitorRedisCommands(
							redis,
							async () => {
								const updated = ids.length === 1
									? await request(spawnedServerUrl())
										.patch(`/items/${ROW}/${ids[0]}`)
										.send(values)
										.set('Authorization', auth)
									: await request(spawnedServerUrl())
										.patch(`/items/${ROW}`)
										.send({ keys: ids, data: values })
										.set('Authorization', auth);

								expect(updated.statusCode).toBe(200);
							},
						);

						sentCommands = countRedisCommands(monitoredCommands, namespace!);
					},
				);

				then(
					'the write sent these Redis commands:',
					(table: Record<string, string>[]) => {
						expect(sentCommands).toEqual(joinBrokenKeys(table));
					},
				);

				and.optional(
					'these reads answer:',
					async (table: Record<string, string>[]) => {
						for (const { query, cache } of table) {
							expect((await readRows(query!)).headers[cacheStatusHeader])
								.toBe(cache);
						}
					},
				);
			}, 60_000);
		}
	});
});
