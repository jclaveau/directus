import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { once } from 'events';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { gunzipSync } from 'zlib';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-fill-pause-older-build.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-fill-pause-older-build-${vendor}`;
	const indexPrefix = `${namespace}:scoped-cache-index:`;
	const markerKey = `${namespace}:scoped-cache-collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;
	const fillPauseKey = `${namespace}:scoped-cache-fill-pause`;
	// The bus follows the cache namespace when BUS_NAMESPACE is unset.
	const queryChannel = `${namespace}:bus:processes:query`;
	const reportChannel = `${namespace}:bus:processes:report`;
	const collection = 'fill_pause_older_build';
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_TTL'] = '1h';
	env[vendor]['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '0 0 1 1 *';
	env[vendor]['CACHE_AUTO_FLUSH_ON_DEPLOY'] = 'false';
	env[vendor]['CACHE_BUILD_ID'] = 'older-build-a';

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;
	let olderProcess: Redis | null = null;

	async function startInstance() {
		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}

	function readByName(row: Record<string, string>) {
		return request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
			.set('Authorization', auth);
	}

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection,
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
			],
		});

		await startInstance();
	}, 60_000);

	afterAll(async () => {
		instance.kill();
		olderProcess?.disconnect();

		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();
		await DeleteCollection(vendor, { collection });
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a process whose report names no build holds the pause while it answers',
			({ given, and, when, then }) => {
				given(
					/^these rows of (\w+):$/,
					async (_rowsOf: string, table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${collection}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				// The report a build older than the field answers with: every field
				// the new build reads but `coreBuildId`. Published raw on the bus the
				// instance subscribes to, as that build's bus publishes it: JSON,
				// gzipped only past 1000 bytes.
				and(
					'a process of a build older than the field answers the processes '
					+ 'query',
					async () => {
						const subscriber = redisClient.duplicate();
						const olderNodeId = randomUUID();

						subscriber.on('messageBuffer', (_channel, message: Buffer) => {
							const query = JSON.parse(String(
								message[0] === 0x1f && message[1] === 0x8b
									? gunzipSync(message)
									: message,
							));

							void redisClient.publish(reportChannel, JSON.stringify({
								requestId: query.requestId,
								service: 'directus',
								replicaId: 'older-replica',
								hostname: 'older-host',
								supervised: false,
								self: {
									nodeId: olderNodeId,
									pid: 1,
									pmId: null,
									instance: null,
									name: 'directus',
									runtime: null,
									env: null,
									autoscale: null,
								},
								supervisor: null,
								capacity: null,
							}));
						});

						await subscriber.subscribe(queryChannel);
						olderProcess = subscriber;
					},
				);

				when(
					/^the instance restarts on ([\w-]+) pausing fills for at most (\w+)$/,
					async (buildId: string, fillPause: string) => {
						instance.kill();
						await once(instance, 'exit');
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = fillPause;
						await startInstance();
					},
				);

				// Three quiet looks 5s apart would have ended it by now, had the
				// report without a build been taken for this one.
				then(/^the fill pause still runs after (\d+)s$/, async (seconds) => {
					await new Promise((resolve) => {
						setTimeout(resolve, Number(seconds) * 1_000);
					});

					expect(await redisClient.pttl(fillPauseKey)).toBeGreaterThan(0);
				});

				// A fill lands within milliseconds of its response, and the reads
				// cached below show one within five seconds: two seconds of nothing
				// filed is none coming.
				and(
					'these reads are not cached:',
					async (table: Record<string, string>[]) => {
						for (const row of table) {
							expect((await readByName(row)).headers[cacheStatusHeader])
								.toBe('MISS');

							await new Promise((resolve) => setTimeout(resolve, 2_000));

							expect((await readByName(row)).headers[cacheStatusHeader])
								.toBe('MISS');

							expect(await redisClient.keys(
								`${indexPrefix}fingerprint:${collection}:*`,
							)).toEqual([]);
						}
					},
				);

				// Nothing deletes the marker: the generation the boot moved is what it
				// no longer names.
				and('the index-key sets are not marked complete', async () => {
					expect(await redisClient.get(markerKey))
						.not.toBe(await redisClient.get(generationKey));
				});

				when('the older process stops answering', async () => {
					olderProcess!.disconnect();
					olderProcess = null;
				});

				then('the fill pause ends long before its ceiling', async () => {
					const pauseLeftMs = await redisClient.pttl(fillPauseKey);

					await expect.poll(() => redisClient.exists(fillPauseKey), {
						timeout: 45_000,
					}).toBe(0);

					expect(pauseLeftMs).toBeGreaterThan(30_000);
				});

				// By the reap the pause asked for as it closed.
				and('the index-key sets are marked complete', async () => {
					await expect.poll(async () => {
						const [marker, generation] = await redisClient.mget(
							markerKey,
							generationKey,
						);

						return marker !== null && marker === generation;
					}, { timeout: 15_000 }).toBe(true);
				});

				and(
					'these reads are cached:',
					async (table: Record<string, string>[]) => {
						for (const row of table) {
							expect((await readByName(row)).headers[cacheStatusHeader])
								.toBe('MISS');

							await expect.poll(async () => {
								return (await readByName(row)).headers[cacheStatusHeader];
							}, { timeout: 5_000 }).toBe('HIT');
						}
					},
				);
			},
			150_000,
		);
	});
});
