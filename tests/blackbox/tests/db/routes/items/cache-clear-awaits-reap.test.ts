import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { createRedisProxy } from '@common/redis-proxy';
import { USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { awaitDirectusConnection } from '@utils/await-connection';
import { sleep } from '@utils/sleep';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const cacheStatusHeader = 'x-cache-status';
const collection = 'clear_awaits_reap_row';
const heldSetMs = 2_000;

const feature = loadFeature(
	'./tests/db/routes/items/cache-clear-awaits-reap.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-clear-awaits-reap-${vendor}`;
	const markerKey = `${namespace}:scoped-cache-collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_TTL'] = '1h';
	env[vendor]['CACHE_AUTO_FLUSH_ON_DEPLOY'] = 'false';
	env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = '0';
	env[vendor]['CACHE_BUILD_ID'] = `clear-awaits-reap-${Date.now()}`;

	// Once a year: only the clear's reap walks the index.
	env[vendor]['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '0 0 1 1 *';

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let proxy: ReturnType<typeof createRedisProxy>;
	let instance: ChildProcess;

	function readRow(query: string) {
		const { fields, filter } = loadYaml(query) as {
			fields: string[];
			filter: Record<string, unknown>;
		};

		return request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query({ fields, filter: JSON.stringify(filter) })
			.set('Authorization', auth);
	}

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection,
				meta: { scoped_cache_fields: ['owner'] },
				fields: [
					{ field: 'owner', type: 'string', meta: {} },
					{ field: 'label', type: 'string', meta: {} },
				],
			}],
		});

		const proxyPort = await getPort();
		proxy = createRedisProxy(6108, proxyPort);
		await proxy.open();
		env[vendor]['REDIS_PORT'] = String(proxyPort);
		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));

		// The boot's own reap, over before the scenario clears.
		await expect.poll(async () => {
			const [marker, generation] = await redisClient.mget(
				markerKey,
				generationKey,
			);

			return marker !== null && marker === generation;
		}, { interval: 100, timeout: 30_000 }).toBe(true);
	}, 60_000);

	afterAll(async () => {
		instance?.kill();
		await proxy?.cut();

		for (const key of await redisClient.keys(`${namespace}*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();
		await DeleteCollection(vendor, { collection });
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a read sent once a clear answered keeps its fill',
			({ given, when, and, then }) => {
				let rowQuery = '';
				let firstRead: request.Response;

				given(
					'the rows of the collection:',
					async (table: Record<string, string>[]) => {
						for (const { owner, label } of parseGherkinTable<{
							owner: string;
							label: string;
						}>(table)) {
							const created = await request(getUrl(vendor, env))
								.post(`/items/${collection}`)
								.send({ owner, label })
								.set('Authorization', auth);

							expect(created.statusCode).toBe(200);
						}
					},
				);

				when('the cache is cleared', async () => {
					await request(getUrl(vendor, env))
						.post('/utils/cache/clear')
						.set('Authorization', auth)
						.expect(200);
				});

				// The held write lands two seconds on, and the fill checks the purge
				// counter after it: waited out before the next read.
				and(
					/^target_1's read fills while its entry write is held two seconds:$/,
					async (table: Record<string, string>[]) => {
						rowQuery = table[0]!.query!;
						proxy.delaySets(heldSetMs);

						try {
							firstRead = await readRow(rowQuery);
						}
						finally {
							proxy.delaySets(0);
						}

						await sleep(heldSetMs + 1_000);
					},
				);

				then('that read answered MISS', () => {
					expect(firstRead.headers[cacheStatusHeader]).toBe('MISS');
				});

				and(
					oneLine`
						the next read of target_1 is a HIT, as no reap walked the index
						during its fill
					`,
					async () => {
						expect((await readRow(rowQuery)).headers[cacheStatusHeader])
							.toBe('HIT');
					},
				);
			},
			60_000,
		);
	});
});
