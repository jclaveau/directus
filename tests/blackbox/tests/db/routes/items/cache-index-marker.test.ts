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
	const markerKey = `${namespace}:scoped-cache-collection-index-keys-complete`;
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
		'index_marker_pause_served',
		'index_marker_unpaused',
	];

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;
	let secondInstance: ChildProcess | null = null;

	async function spawnInstance(instanceEnv: NodeJS.ProcessEnv) {
		const spawned = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: instanceEnv,
		});

		await awaitDirectusConnection(Number(instanceEnv['PORT']));

		return spawned;
	}

	async function startInstance() {
		env[vendor].PORT = String(await getPort());
		instance = await spawnInstance(env[vendor]);
	}

	async function restartInstance() {
		instance.kill();
		await once(instance, 'exit');
		await startInstance();
	}

	function readByName(collection: string, row: Record<string, string>) {
		return request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
			.set('Authorization', auth);
	}

	// Every member the collection's index sets hold: a fill files its read here
	// before it writes the value.
	async function indexMembersOf(collection: string) {
		const members: string[] = [];

		for (const setKey of await redisClient.keys(
			`${indexPrefix}fingerprint:${collection}:*`,
		)) {
			members.push(...await redisClient.smembers(setKey));
		}

		return members.sort();
	}

	// A fill lands within milliseconds of its response, and the reads cached
	// below show one within five seconds: two seconds of nothing filed is none
	// coming.
	async function expectNotCached(
		collection: string,
		table: Record<string, string>[],
	) {
		for (const row of table) {
			const membersBefore = await indexMembersOf(collection);

			expect((await readByName(collection, row)).headers[cacheStatusHeader])
				.toBe('MISS');

			await new Promise((resolve) => setTimeout(resolve, 2_000));

			expect((await readByName(collection, row)).headers[cacheStatusHeader])
				.toBe('MISS');

			expect(await indexMembersOf(collection)).toEqual(membersBefore);
		}
	}

	async function expectCached(
		collection: string,
		table: Record<string, string>[],
	) {
		for (const row of table) {
			expect((await readByName(collection, row)).headers[cacheStatusHeader])
				.toBe('MISS');

			// The fill lands after the response.
			await expect.poll(async () => {
				return (await readByName(collection, row)).headers[cacheStatusHeader];
			}, { timeout: 5_000 }).toBe('HIT');
		}
	}

	// Beside the instance, on the bus and the Redis it shares, as a node of the
	// build before goes on running through a rolling deploy.
	async function startSecondInstance(buildId: string) {
		secondInstance = await spawnInstance({
			...env[vendor],
			PORT: String(await getPort()),
			CACHE_BUILD_ID: buildId,
			CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: '0',
		});
	}

	async function stopSecondInstance() {
		secondInstance!.kill();
		await once(secondInstance!, 'exit');
		secondInstance = null;
	}

	async function restartOnBuild(buildId: string, fillPause: string) {
		env[vendor]['CACHE_BUILD_ID'] = buildId;
		env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = fillPause;
		await restartInstance();
	}

	// Three quiet looks 5s apart, after a watch a restarted instance's
	// predecessor may have held for 15s: well inside a 2m ceiling.
	async function expectFillPauseEndsEarly() {
		const pauseLeftMs = await redisClient.pttl(fillPauseKey);

		await expect.poll(() => redisClient.exists(fillPauseKey), {
			timeout: 45_000,
		}).toBe(0);

		expect(pauseLeftMs).toBeGreaterThan(50_000);
	}

	// The reads the purge sends to this collection's index sets, as MONITOR sees
	// them. A moved set's key carries a fresh uuid, spelled `<sweep>` here.
	async function purgeEveryReadOf(collection: string) {
		const purgeReads: Record<string, string>[] = [];

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

		return purgeReads;
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
		secondInstance?.kill();

		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();

		for (const collection of collections) {
			await DeleteCollection(vendor, { collection });
		}
	});

	defineFeature(feature, (scenario) => {
		// Its own steps: jest-cucumber binds definitions to steps in order, and
		// this one caches a read on either side of the flush.
		scenario(
			'a flush with no reap scheduled keeps the index-key sets marked complete',
			({ given, and, when, then }) => {
				const collection = 'index_marker_flush';

				const collectionIndexKeysKey
					= `${indexPrefix}collection-index-keys:${collection}`;

				let flushedGeneration: string | null = null;
				let purgeReads: Record<string, string>[] = [];

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

				and('these reads are cached:', (table: Record<string, string>[]) => {
					return expectCached(collection, table);
				});

				and('the index-key sets are marked complete', async () => {
					await expect.poll(async () => {
						const [marker, generation] = await redisClient.mget(
							markerKey,
							generationKey,
						);

						return marker !== null && marker === generation;
					}, { timeout: 15_000 }).toBe(true);
				});

				when('the cache is flushed', async () => {
					flushedGeneration = await redisClient.get(generationKey);

					const flushed = await request(getUrl(vendor, env))
						.post('/utils/cache/clear')
						.set('Authorization', auth);

					expect(flushed.statusCode).toBe(200);
				});

				// Read as the flush answers, before any reap: the flush unlinks only
				// the index sets, and moves neither the marker nor the generation.
				then(
					'the index-key sets are still marked complete at the generation '
					+ 'before the flush',
					async () => {
						expect(await redisClient.mget(markerKey, generationKey))
							.toEqual([flushedGeneration, flushedGeneration]);
					},
				);

				// Only the pass the flush asked for releases the names whose set the
				// flush unlinked: the marker still vouches, and the schedule is a year
				// out.
				and(
					/^the index-key set of \w+ names no set, a reap later$/,
					async () => {
						await expect.poll(() => redisClient.scard(collectionIndexKeysKey), {
							timeout: 15_000,
						}).toBe(0);
					},
				);

				and('these reads are cached:', (table: Record<string, string>[]) => {
					return expectCached(collection, table);
				});

				when(/^every read of \w+ is purged$/, async () => {
					purgeReads = await purgeEveryReadOf(collection);
				});

				then(
					'the purge read these index sets, in order:',
					(table: Record<string, string>[]) => {
						expect(purgeReads).toEqual(table);
					},
				);

				and('these reads answer:', async (table: Record<string, string>[]) => {
					for (const row of table) {
						expect((await readByName(collection, row)).headers[cacheStatusHeader])
							.toBe(row['cache']);
					}
				});
			},
			60_000,
		);

		for (const scenarioTitle of [
			'the wholesale counter expiring leaves the index-key sets trusted',
			'a restart on the same build leaves the marker vouching',
			'a restart on another build moves the generation past the marker, '
			+ 'with auto-flush off',
		]) {
			scenario(scenarioTitle, ({ given, and, when, then }) => {
				let collection = '';
				let keptMarker: string | null = null;
				const purgeReads: Record<string, string>[] = [];

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

				and.optional(
					'these reads are cached:',
					(table: Record<string, string>[]) => {
						return expectCached(collection, table);
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

				when.optional(/^every read of \w+ is purged$/, async () => {
					purgeReads.push(...await purgeEveryReadOf(collection));
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
							expect((await readByName(collection, row)).headers[cacheStatusHeader])
								.toBe(row['cache']);
						}
					},
				);
			}, 60_000);
		}

		// Its own steps: jest-cucumber binds definitions to steps in order, and
		// this one restarts and reads twice.
		scenario(
			'a restart on another build fills no read while the build before '
			+ 'answers',
			({ given, when, then, and }) => {
				const collection = 'index_marker_pause';
				let keptPauseLeftMs = 0;

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

				and(/^a second instance runs on ([\w-]+)$/, startSecondInstance);

				when(
					/^the instance restarts on ([\w-]+) pausing fills for at most (\w+)$/,
					restartOnBuild,
				);

				then('these reads are not cached:', (table: Record<string, string>[]) => {
					return expectNotCached(collection, table);
				});

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

				and('these reads are not cached:', (table: Record<string, string>[]) => {
					return expectNotCached(collection, table);
				});

				// Both boots asked for a reap, and neither may mark while the build
				// before could still be filing. Nothing deletes the marker: the
				// generation the boot moved is what it no longer names.
				and('the index-key sets are not marked complete', async () => {
					expect(await redisClient.get(markerKey))
						.not.toBe(await redisClient.get(generationKey));
				});

				when('the second instance stops', stopSecondInstance);

				then(
					'the fill pause ends long before its ceiling',
					expectFillPauseEndsEarly,
				);

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

				and('these reads are cached:', (table: Record<string, string>[]) => {
					return expectCached(collection, table);
				});
			},
			150_000,
		);

		// After the one above, whose pause it must not start inside.
		scenario(
			'a restart on another build still answers what was cached before it',
			({ given, and, when, then }) => {
				let collection = '';

				given(
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

				and(
					'these reads are cached:',
					(table: Record<string, string>[]) => {
						return expectCached(collection, table);
					},
				);

				and(
					/^a second instance runs on ([\w-]+)$/,
					startSecondInstance,
				);

				when(
					/^the instance restarts on ([\w-]+) pausing fills for at most (\w+)$/,
					restartOnBuild,
				);

				// Served by the cache: the pause gates the fill, not the read.
				then(
					'these reads answer:',
					async (table: Record<string, string>[]) => {
						for (const row of table) {
							expect((await readByName(collection, row))
								.headers[cacheStatusHeader]).toBe(row['cache']);
						}
					},
				);

				and(
					'these reads are not cached:',
					(table: Record<string, string>[]) => {
						return expectNotCached(collection, table);
					},
				);

				when('the second instance stops', stopSecondInstance);

				then(
					'the fill pause ends long before its ceiling',
					expectFillPauseEndsEarly,
				);
			},
			150_000,
		);

		// After the one above, whose pause it must not start inside: a max of 0
		// joins a pause still running.
		scenario(
			'a restart on another build with a max of 0 fills at once while the '
				+ 'build before answers',
			({ given, and, when, then }) => {
				let collection = '';

				given(
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

				and(/^a second instance runs on ([\w-]+)$/, startSecondInstance);

				when(
					/^the instance restarts on ([\w-]+) pausing fills for at most (\w+)$/,
					restartOnBuild,
				);

				then('no fill pause runs', async () => {
					expect(await redisClient.exists(fillPauseKey)).toBe(0);
				});

				and('these reads are cached:', (table: Record<string, string>[]) => {
					return expectCached(collection, table);
				});

				when('the second instance stops', stopSecondInstance);
			},
			150_000,
		);
	});
});
