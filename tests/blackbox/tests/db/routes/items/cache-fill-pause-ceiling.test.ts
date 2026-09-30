import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { once } from 'events';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-fill-pause-ceiling.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-fill-pause-ceiling-${vendor}`;
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
	env[vendor]['CACHE_BUILD_ID'] = 'ceiling-build-a';
	// The line the pause logs as it ends is an info one.
	env[vendor]['LOG_LEVEL'] = 'info';
	env[vendor]['LOG_STYLE'] = 'raw';

	const collections = [
		'fill_pause_ceiling_outlived',
		'fill_pause_ceiling_unreported',
	];

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;
	let instanceLog: string[] = [];
	let secondInstance: ChildProcess | null = null;

	// Beside the instance, on the bus and the Redis it shares, as a node of the
	// build before goes on running through a rolling deploy. Its output is not
	// read, so it is not piped: a full pipe would stall it.
	async function startSecondInstance() {
		const port = await getPort();

		secondInstance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			stdio: 'ignore',
			env: {
				...env[vendor],
				PORT: String(port),
				CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: '0',
				PROCESSES_REPORT_ENABLED: 'true',
			},
		});

		await awaitDirectusConnection(port);
	}

	async function stopSecondInstance() {
		secondInstance!.kill();
		await once(secondInstance!, 'exit');
		secondInstance = null;
	}

	async function startInstance() {
		env[vendor].PORT = String(await getPort());
		instanceLog = [];

		const spawned = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		spawned.stdout?.on('data', (chunk) => instanceLog.push(String(chunk)));
		spawned.stderr?.on('data', (chunk) => instanceLog.push(String(chunk)));
		instance = spawned;

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}

	// Logged at the first look past the end, at most one look later.
	async function expectResumedLogged(endedHow: string) {
		const resumedLine = new RegExp(
			String.raw`\[scoped-cache\] fills resumed \d+ ms into the pause after a `
			+ String.raw`deploy, ${endedHow}`,
		);

		await expect.poll(() => resumedLine.test(instanceLog.join('')), {
			timeout: 10_000,
		}).toBe(true);
	}

	async function restartInstance() {
		instance.kill();
		await once(instance, 'exit');
		await startInstance();
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
		for (const scenarioTitle of [
			'a pause the build before outlives ends at its ceiling',
			'a node with its process reports off runs the pause to its ceiling',
		]) {
			scenario(scenarioTitle, ({ given, and, when, then }) => {
				let collection = '';
				let processReportsOff = false;

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

				given.optional(
					'a second instance runs on the recorded build',
					startSecondInstance,
				);

				and.optional(
					"the instance's process reports are off from its next boot",
					() => {
						processReportsOff = true;
					},
				);

				when.optional(
					/^the instance restarts on ([\w-]+) pausing fills for at most (\w+)$/,
					async (buildId: string, fillPause: string) => {
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = fillPause;
						env[vendor]['PROCESSES_REPORT_ENABLED'] = String(!processReportsOff);
						await restartInstance();
					},
				);

				// A fill lands within milliseconds of its response: two seconds of
				// nothing filed is none coming.
				then.optional(
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
				and.optional('the index-key sets are not marked complete', async () => {
					expect(await redisClient.get(markerKey))
						.not.toBe(await redisClient.get(generationKey));
				});

				// The pause lives out the expiry the boot gave it: no watcher took it
				// back early.
				and.optional('the fill pause ends at its ceiling', async () => {
					const pauseLeftMs = await redisClient.pttl(fillPauseKey);
					const readAt = Date.now();

					expect(pauseLeftMs).toBeGreaterThan(0);

					await expect.poll(() => redisClient.exists(fillPauseKey), {
						timeout: 30_000,
					}).toBe(0);

					expect(Date.now() - readAt)
						.toBeGreaterThanOrEqual(pauseLeftMs - 100);
				});

				and.optional(
					'the instance logged how its fills resumed:',
					(table: Record<string, string>[]) => {
						return expectResumedLogged(table[0]!['ended']!);
					},
				);

				// By the reap the pause asked for as it closed.
				and.optional('the index-key sets are marked complete', async () => {
					await expect.poll(async () => {
						const [marker, generation] = await redisClient.mget(
							markerKey,
							generationKey,
						);

						return marker !== null && marker === generation;
					}, { timeout: 15_000 }).toBe(true);
				});

				and.optional(
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

				when.optional('the second instance stops', stopSecondInstance);
			}, 120_000);
		}

		// Its own steps: jest-cucumber binds definitions to steps in order, and
		// this one stops the second instance before what it reads.
		scenario(
			'a pause the build before leaves logs the quiet looks that ended it',
			({ given, when, then, and }) => {
				given('a second instance runs on the recorded build', startSecondInstance);

				when(
					/^the instance restarts on ([\w-]+) pausing fills for at most (\w+)$/,
					async (buildId: string, fillPause: string) => {
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = fillPause;
						env[vendor]['PROCESSES_REPORT_ENABLED'] = 'true';
						await restartInstance();
					},
				);

				and('the second instance stops', stopSecondInstance);

				// Three quiet looks 5s apart, after a watch the restarted instance's
				// predecessor held for 15s: well inside the 2m ceiling.
				then('the fill pause ends long before its ceiling', async () => {
					const pauseLeftMs = await redisClient.pttl(fillPauseKey);

					await expect.poll(() => redisClient.exists(fillPauseKey), {
						timeout: 45_000,
					}).toBe(0);

					expect(pauseLeftMs).toBeGreaterThan(50_000);
				});

				and(
					'the instance logged how its fills resumed:',
					(table: Record<string, string>[]) => {
						return expectResumedLogged(table[0]!['ended']!);
					},
				);
			},
			120_000,
		);
	});
});
