import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
} from 'vitest';

const NOTE = 'redis_db_flush_note';
const CACHE_DATABASE = 7;
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-redis-db-flush.feature',
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
	env[vendor]['CACHE_AUTO_FLUSH_ON_DEPLOY'] = 'true';
	env[vendor]['LOG_LEVEL'] = 'info';

	const witnessKey = `redis-db-flush-witness-${vendor}`;
	const flushNamespace = `directus-redis-db-flush-${vendor}-cli`;

	// The shape `@keyv/redis` files a Keyv entry under: the store prefixes the key
	// Keyv already prefixed, both with the tier's namespace.
	const systemEntryKey
		= `${flushNamespace}_system::${flushNamespace}_system:flush-witness`;

	const responseEntryKey
		= `${flushNamespace}_response::${flushNamespace}_response:flush-witness`;

	const redisByDatabase = {
		shared: new Redis({ host: 'localhost', port: 6108 }),
		cache: new Redis({ host: 'localhost', port: 6108, db: CACHE_DATABASE }),
	};

	const adminAuth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess | undefined;
	let instanceLog: string[] = [];
	let flushRun: { code: number | null; output: string } | undefined;
	let namespace: string;
	let noteId: number;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection: NOTE,
				meta: { scoped_cache_fields: ['slot'] },
				fields: [
					{ field: 'slot', type: 'string', meta: {} },
					{ field: 'label', type: 'string', meta: {} },
				],
			}],
		});

		noteId = (await CreateItem(vendor, {
			collection: NOTE,
			item: { slot: 'a', label: 'v1' },
		})).id;
	});

	// Awaited: the shard reuses the port range straight away, and an instance
	// still shutting down is still holding its port.
	afterEach(async () => {
		if (instance && instance.exitCode === null) {
			const exited = new Promise((resolve) => instance!.once('exit', resolve));
			instance.kill();
			await exited;
		}

		instance = undefined;
		instanceLog = [];
		flushRun = undefined;

		await redisByDatabase.shared.del(
			witnessKey,
			systemEntryKey,
			responseEntryKey,
		);

		await redisByDatabase.cache.del(witnessKey);

		// A pause left running would hold the fills of the next instance, which
		// joins it.
		await redisByDatabase.shared.del(`${namespace}:scoped-cache-fill-pause`);
		await redisByDatabase.cache.del(`${namespace}:scoped-cache-fill-pause`);

		// An instance killed mid-reap leaves its reap's lock for its TTL, 120s,
		// and the next instance's reap waits it out before marking the index.
		const reapLocks = await redisByDatabase.shared.keys(
			`${namespace}_lock*scoped-cache-index:reap`,
		);

		if (reapLocks.length > 0) {
			await redisByDatabase.shared.del(...reapLocks);
		}
	});

	afterAll(async () => {
		await redisByDatabase.cache.flushdb();

		await redisByDatabase.shared.del(
			`${namespace}:scoped-cache-index-build`,
			`${namespace}:scoped-cache-index-generation`,
			`${namespace}:scoped-cache-collection-index-keys-complete`,
			`${namespace}:scoped-cache-fill-pause-watch`,
		);

		await redisByDatabase.shared.quit();
		await redisByDatabase.cache.quit();
		await DeleteCollection(vendor, { collection: NOTE });
	});

	async function bootInstance(
		database: string,
		instanceOverrides: Record<string, string> = {},
	) {
		const port = await getPort();
		const instanceEnv = cloneDeep(env);
		Object.assign(instanceEnv[vendor], instanceOverrides);

		namespace = `directus-redis-db-flush-${vendor}-db${database}`;
		instanceEnv[vendor]['CACHE_NAMESPACE'] = namespace;
		instanceEnv[vendor]['CACHE_REDIS_DB'] = database;
		instanceEnv[vendor]['CACHE_BUILD_ID'] = `redis-db-flush-${Date.now()}`;
		instanceEnv[vendor].PORT = String(port);
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: instanceEnv[vendor],
		});

		instance.stdout?.on('data', (chunk) => instanceLog.push(String(chunk)));
		instance.stderr?.on('data', (chunk) => instanceLog.push(String(chunk)));

		await awaitDirectusConnection(port);
	}

	function readNote() {
		return request(getUrl(vendor, env))
			.get(`/items/${NOTE}`)
			.query({ 'filter[slot][_eq]': 'a', fields: ['id', 'label'] })
			.set('Authorization', adminAuth);
	}

	function defineScenarioSteps({ given, and, when, then }: StepFunctions) {
		given.optional(
			'the cache database holds a key outside every namespace',
			async () => {
				await redisByDatabase.cache.set(witnessKey, 'before-boot');
			},
		);

		given.optional('the system cache holds an entry', async () => {
			await redisByDatabase.shared.set(systemEntryKey, 'before-flush');
		});

		// Its own process, as a deploy step runs it: the stores it builds are
		// dialed in the same tick the flush clears them.
		async function runCacheFlush(database?: string) {
			const flushEnv = cloneDeep(env);
			flushEnv[vendor]['CACHE_NAMESPACE'] = flushNamespace;

			if (database !== undefined) {
				flushEnv[vendor]['CACHE_REDIS_DB'] = database;
			}

			const cli = spawn('node', [paths.cli, 'cache', 'flush'], {
				cwd: paths.cwd,
				env: flushEnv[vendor],
			});

			let output = '';

			cli.stdout.on('data', (chunk) => (output += String(chunk)));
			cli.stderr.on('data', (chunk) => (output += String(chunk)));

			// `close` waits for the output streams to drain, where `exit` can
			// land before the last log line does.
			const code = await new Promise<number | null>((resolve, reject) => {
				const killTimer = setTimeout(() => {
					cli.kill();
					reject(new Error(`directus cache flush hung:\n${output}`));
				}, 30_000);

				cli.on('error', (spawnError) => {
					clearTimeout(killTimer);
					reject(spawnError);
				});

				cli.on('close', (exitCode) => {
					clearTimeout(killTimer);
					resolve(exitCode);
				});
			});

			flushRun = { code, output };
		}

		given.optional('the response cache holds an entry', async () => {
			await redisByDatabase.shared.set(responseEntryKey, 'before-flush');
		});

		when.optional(
			/^`directus cache flush` runs with its cache in database (\d+)$/,
			runCacheFlush,
		);

		when.optional(
			'`directus cache flush` runs with its cache in the shared database',
			() => runCacheFlush(),
		);

		then.optional('it exits 0', () => {
			expect(flushRun!.code, flushRun!.output).toBe(0);
		});

		and.optional('the system cache no longer holds that entry', async () => {
			expect(await redisByDatabase.shared.exists(systemEntryKey)).toBe(0);
		});

		and.optional('the response cache no longer holds that entry', async () => {
			expect(await redisByDatabase.shared.exists(responseEntryKey)).toBe(0);
		});

		when.optional(
			/^an instance keeping its cache in database (\d+) boots on a new build$/,
			bootInstance,
		);

		given.optional(
			/^an instance keeping its cache in database (\d+)$/,
			bootInstance,
		);

		// The MISS then HIT proves there is an entry for the steps after to find.
		and.optional('a note read is cached', async () => {
			expect((await readNote()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readNote()).headers[cacheStatusHeader]).toBe('HIT');
		});

		// By the pass the boot asked for.
		and.optional(
			'the shared database marks the index-key sets complete',
			async () => {
				await expect.poll(async () => {
					const [marker, generation] = await redisByDatabase.shared.mget(
						`${namespace}:scoped-cache-collection-index-keys-complete`,
						`${namespace}:scoped-cache-index-generation`,
					);

					return marker !== null && marker === generation;
				}, { timeout: 15_000 }).toBe(true);
			},
		);

		and.optional(
			/^a key outside every namespace is set in the (cache|shared) database$/,
			async (database: 'cache' | 'shared') => {
				await redisByDatabase[database].set(witnessKey, 'before-clear');
			},
		);

		when.optional('the cache is cleared', async () => {
			const cleared = await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', adminAuth);

			expect(cleared.status).toBe(200);
		});

		when.optional(
			/^the note's label is changed to "(.*)"$/,
			async (label: string) => {
				const changed = await request(getUrl(vendor, env))
					.patch(`/items/${NOTE}/${noteId}`)
					.send({ label })
					.set('Authorization', adminAuth);

				expect(changed.status).toBe(200);
			},
		);

		then.optional(
			/^the (cache|shared) database no longer holds that key$/,
			async (database: 'cache' | 'shared') => {
				expect(await redisByDatabase[database].exists(witnessKey)).toBe(0);
			},
		);

		then.optional(
			/^the (cache|shared) database still holds that key$/,
			async (database: 'cache' | 'shared') => {
				expect(await redisByDatabase[database].get(witnessKey))
					.toBe('before-clear');
			},
		);

		and.optional(/^the instance logs "(.*)"$/, (line: string) => {
			expect(instanceLog.join('')).toContain(line);
		});

		and.optional(/^the flush logs "(.*)"$/, (line: string) => {
			expect(flushRun!.output).toContain(line);
		});

		and.optional(/^the flush logs nothing saying "(.*)"$/, (line: string) => {
			expect(flushRun!.output).not.toContain(line);
		});

		and.optional(
			/^the next note read is a "(HIT|MISS)"(?: showing "(.*)")?$/,
			async (cacheStatus: string, label: string | undefined) => {
				const read = await readNote();

				expect(read.headers[cacheStatusHeader]).toBe(cacheStatus);

				if (label !== undefined) {
					expect(read.body.data).toEqual([{ id: noteId, label }]);
				}
			},
		);

		and.optional('the shared database holds the build fingerprint', async () => {
			expect(
				await redisByDatabase.shared.keys(`${namespace}_lock*build-identity`),
			).toHaveLength(1);
		});

		// Read as the clear answers, before the reap it asked for: the FLUSHDB
		// took the database the marker is not in.
		and.optional(
			'the shared database still marks the index-key sets complete',
			async () => {
				const [marker, generation] = await redisByDatabase.shared.mget(
					`${namespace}:scoped-cache-collection-index-keys-complete`,
					`${namespace}:scoped-cache-index-generation`,
				);

				expect(marker).not.toBeNull();
				expect(marker).toBe(generation);
			},
		);

		and.optional('the cache database holds no lock', async () => {
			expect(await redisByDatabase.cache.keys(`${namespace}_lock*`))
				.toEqual([]);
		});

		then.optional(
			'the cache database holds the note\'s cached read and its index',
			async () => {
				expect(await redisByDatabase.cache.keys(`${namespace}_response*`))
					.not.toEqual([]);

				expect(
					await redisByDatabase.cache.keys(`${namespace}:scoped-cache-index:*`),
				).not.toEqual([]);
			},
		);

		and.optional('the shared database holds neither', async () => {
			expect(await redisByDatabase.shared.keys(`${namespace}_response*`))
				.toEqual([]);

			expect(
				await redisByDatabase.shared.keys(`${namespace}:scoped-cache-index:*`),
			).toEqual([]);
		});
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a boot on a new build empties the cache database',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'the flush command empties the system cache and the cache database',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'the flush command empties a response cache sharing its database',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'a cached read and its index are filed in the cache database',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'clearing the cache empties the cache database',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'a write after the boot flush purges its slice',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'a cache database equal to the one REDIS selects is ignored',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'clearing the cache leaves a deploy\'s fill pause running',
			({ given, and, when, then }) => {
				given(
					new RegExp([
						String.raw`^an instance keeping its cache in database (\d+) boots`,
						String.raw`on a new build pausing its fills for at most (\w+),`,
						'its process reports off$',
					].join(' ')),
					async (database: string, fillPause: string) => {
						await bootInstance(database, {
							CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: fillPause,
							PROCESSES_REPORT_ENABLED: 'false',
						});
					},
				);

				// The build is recorded once Redis is ready, which the boot does not
				// wait for: a clear before it would open the pause after itself.
				and(/^the instance logs "(.*)"$/, async (line: string) => {
					await expect.poll(() => instanceLog.join(''), { timeout: 10_000 })
						.toContain(line);
				});

				when('the cache is cleared', async () => {
					const cleared = await request(getUrl(vendor, env))
						.post('/utils/cache/clear')
						.set('Authorization', adminAuth);

					expect(cleared.status).toBe(200);
				});

				// A paused node looks at the pause every 5s, and the first look
				// after a FLUSHDB that took it resumes the fills: a read then files
				// its entry, and the one 2s later is a HIT.
				then(
					'a note read is not cached, a look at the fill pause later',
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 7_000));

						expect((await readNote()).headers[cacheStatusHeader]).toBe('MISS');

						await new Promise((resolve) => setTimeout(resolve, 2_000));

						expect((await readNote()).headers[cacheStatusHeader]).toBe('MISS');
					},
				);

				and(
					'the shared database holds the recorded build, the index generation '
					+ 'and the fill pause',
					async () => {
						expect(await redisByDatabase.shared.exists(
							`${namespace}:scoped-cache-index-build`,
							`${namespace}:scoped-cache-index-generation`,
							`${namespace}:scoped-cache-fill-pause`,
						)).toBe(3);
					},
				);
			},
			60_000,
		);
	});
});
