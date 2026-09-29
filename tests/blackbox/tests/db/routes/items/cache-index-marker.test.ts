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
import { afterAll, beforeAll, describe, expect } from 'vitest';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature('./tests/db/routes/items/cache-index-marker.feature');

// The purges come from the cache-collection-purge extension: a row handed over
// without its primary key leaves the purge nothing to bind, so it drops every
// read of the collection.
describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-index-marker-${vendor}`;
	const indexPrefix = `${namespace}:scoped-cache-index:`;
	const markerKey = `${indexPrefix}collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;
	const fillPauseKey = `${namespace}:scoped-cache-fill-pause`;
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
	env[vendor]['CACHE_BUILD_ID'] = 'marker-build-a';

	const collections = [
		'index_marker_flush',
		'index_marker_counter',
		'index_marker_pause',
	];

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	async function startInstance() {
		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: collections.map((collection) => {
				return {
					collection,
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				};
			}),
		});

		await startInstance();
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();

		for (const collection of collections) {
			await DeleteCollection(vendor, { collection });
		}
	});

	defineFeature(feature, (scenario) => {
		for (const scenarioTitle of [
			'a flush with no reap scheduled has the index-key sets marked complete '
				+ 'again',
			'the wholesale counter expiring leaves the index-key sets trusted',
			'a restart on the same build leaves the marker vouching',
			'a restart on another build takes the marker back, with auto-flush off',
		]) {
			scenario(scenarioTitle, ({ given, and, when, then }) => {
				let collection = '';
				let flushedGeneration: string | null = null;
				let keptMarker: string | null = null;
				const purgeReads: Record<string, string>[] = [];

				function readByName(row: Record<string, string>) {
					return request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
						.set('Authorization', auth);
				}

				given.optional(
					/^these rows of (\w+):$/,
					async (rowsOf: string, table: Record<string, string>[]) => {
						collection = rowsOf;

						const created = await request(getUrl(vendor, env))
							.post(`/items/${collection}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				when.optional('the cache is flushed', async () => {
					flushedGeneration = await redisClient.get(generationKey);

					const flushed = await request(getUrl(vendor, env))
						.post('/utils/cache/clear')
						.set('Authorization', auth);

					expect(flushed.statusCode).toBe(200);
				});

				// Written only by the pass the flush asked for: the schedule is a
				// year out.
				then.optional(
					'the index-key sets are marked complete at a generation after the '
					+ 'flush',
					async () => {
						await expect.poll(async () => {
							const [marker, generation] = await redisClient.mget(
								markerKey,
								generationKey,
							);

							return marker === generation && generation !== flushedGeneration;
						}, { timeout: 15_000 }).toBe(true);
					},
				);

				and.optional(
					'these reads are cached:',
					async (table: Record<string, string>[]) => {
						for (const row of table) {
							expect((await readByName(row)).headers[cacheStatusHeader])
								.toBe('MISS');

							// The fill lands after the response.
							await expect.poll(async () => {
								return (await readByName(row)).headers[cacheStatusHeader];
							}, { timeout: 5_000 }).toBe('HIT');
						}
					},
				);

				// By the pass the boot asked for, or a flush before it.
				given.optional('the index-key sets are marked complete', async () => {
					await expect.poll(async () => {
						const [marker, generation] = await redisClient.mget(
							markerKey,
							generationKey,
						);

						return marker !== null && marker === generation;
					}, { timeout: 15_000 }).toBe(true);
				});

				and.optional('the wholesale counter expires', async () => {
					expect(await redisClient.del(`${namespace}:scoped-cache-epoch:*`))
						.toBe(1);
				});

				and.optional('the marker is kept as it reads now', async () => {
					keptMarker = await redisClient.get(markerKey);
					expect(keptMarker).not.toBeNull();
				});

				when.optional(
					/^the instance restarts on the build ([\w-]+)$/,
					async (buildId: string) => {
						instance.kill();
						await once(instance, 'exit');
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						await startInstance();
					},
				);

				// Unchanged by the boot: a boot on the recorded build moves nothing.
				then.optional(
					'the kept marker still names the index generation',
					async () => {
						expect(await redisClient.get(generationKey)).toBe(keptMarker);
					},
				);

				// Read against the generation, not the marker: the reap that boot
				// asked for writes a marker of its own.
				then.optional(
					'the kept marker no longer names the index generation',
					async () => {
						await expect.poll(() => redisClient.get(generationKey), {
							timeout: 15_000,
						}).not.toBe(keptMarker);
					},
				);

				// The reads the purge sends to this collection's index sets, as
				// MONITOR sees them. A moved set's key carries a fresh uuid, spelled
				// `<sweep>` here.
				when.optional(/^every read of \w+ is purged$/, async () => {
					const monitor = redisClient.duplicate({
						monitor: true,
						lazyConnect: false,
					});

					await new Promise<void>((resolveMonitoring, rejectMonitoring) => {
						monitor.once('monitoring', resolveMonitoring);

						// ioredis flips to monitoring only after the OK resolves, so a
						// line landing in the same chunk finds an empty command queue.
						monitor.on('error', (monitorError: Error) => {
							if (!monitorError.message.startsWith('Command queue state error')) {
								rejectMonitoring(monitorError);
							}
						});
					});

					const endSentinel = `${namespace}:monitor-sentinel:${randomUUID()}`;

					const endSeen = new Promise<void>((resolveEnd) => {
						monitor.on('monitor', (_time: string, commandArgs: string[]) => {
							const command = commandArgs[0]!.toLowerCase();

							const indexKeys = commandArgs.slice(1).filter((key) => {
								return key.startsWith(indexPrefix);
							});

							const indexRead = {
								command,
								keys: indexKeys.map((key) => {
									return key.slice(indexPrefix.length)
										.replace(/[0-9a-f-]{36}/, '<sweep>');
								}).join(' '),
							};

							if (commandArgs[1] === endSentinel) {
								resolveEnd();
							}
							// Once per key read: a scan of the keyspace takes several pages.
							else if (
								['scan', 'sscan'].includes(command)
								&& indexKeys.some((key) => key.includes(collection))
								&& !purgeReads.some((purgeRead) => {
									return purgeRead['command'] === command
										&& purgeRead['keys'] === indexRead.keys;
								})
							) {
								purgeReads.push(indexRead);
							}
						});
					});

					const purged = await request(getUrl(vendor, env))
						.post(`/cache-collection-purge/${collection}`)
						.set('Authorization', auth);

					expect(purged.statusCode).toBe(200);

					await Promise.all([endSeen, redisClient.get(endSentinel)]);
					monitor.disconnect();
				});

				then.optional(
					'the purge read these index sets, in order:',
					(table: Record<string, string>[]) => {
						expect(purgeReads).toEqual(table);
					},
				);

				then.optional(
					'these reads answer:',
					async (table: Record<string, string>[]) => {
						for (const row of table) {
							expect((await readByName(row)).headers[cacheStatusHeader])
								.toBe(row['cache']);
						}
					},
				);
			}, 60_000);
		}

		// Its own steps: jest-cucumber binds definitions to steps in order, and
		// this one restarts and reads twice.
		scenario(
			'a restart on another build serves every read uncached until its fill '
			+ 'pause ends',
			({ given, when, then, and }) => {
				const collection = 'index_marker_pause';
				let keptPauseLeftMs = 0;

				function readByName(row: Record<string, string>) {
					return request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
						.set('Authorization', auth);
				}

				async function restartInstance() {
					instance.kill();
					await once(instance, 'exit');
					await startInstance();
				}

				// A fill lands within milliseconds of its response, and the reads
				// cached below show one within five seconds: two seconds of nothing
				// filed is none coming.
				async function expectNotCached(table: Record<string, string>[]) {
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
				}

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

				when(
					/^the instance restarts on ([\w-]+) pausing fills for (\w+)$/,
					async (buildId: string, fillPause: string) => {
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE'] = fillPause;
						await restartInstance();
					},
				);

				then('these reads are not cached:', expectNotCached);

				and('the fill pause left is kept as it reads now', async () => {
					keptPauseLeftMs = await redisClient.pttl(fillPauseKey);
					expect(keptPauseLeftMs).toBeGreaterThan(0);
				});

				// The replica boots with the same pause configured: one that opened a
				// window of its own would read the whole of it again.
				when(
					/^the instance restarts on ([\w-]+) again$/,
					restartInstance,
				);

				then('the fill pause left is no longer than the kept one', async () => {
					expect(await redisClient.pttl(fillPauseKey))
						.toBeLessThan(keptPauseLeftMs);
				});

				and('these reads are not cached:', expectNotCached);

				// Both boots asked for a reap, and neither may mark while the build
				// before could still be filing.
				and('the index-key sets are not marked complete', async () => {
					expect(await redisClient.get(markerKey)).toBeNull();
				});

				when('the fill pause ends', async () => {
					await expect.poll(() => redisClient.exists(fillPauseKey), {
						timeout: 40_000,
					}).toBe(0);
				});

				// By the reap the pause asked for as it closed.
				then('the index-key sets are marked complete', async () => {
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
