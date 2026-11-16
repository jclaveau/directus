import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { sleep } from '@utils/sleep';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { ChildProcess, spawn } from 'child_process';
import Redis from 'ioredis';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const collection = 'stats_truncate_drain_row';
const lockedTable = 'directus_cache_stats_scoped_entry_pins';

const feature = loadFeature(
	'./tests/db/app/cache-stats-truncate-drain.feature',
);

// TODO(#610): `LOCK TABLE` and `pg_locks` are postgres's; MariaDB and SQLite
// would need a hold of their own.
describe.runIf(vendors.includes('postgres'))('postgres', () => {
	const vendor = 'postgres';
	const namespace = `directus-stats-truncate-drain-${vendor}`;
	const streamName = `${namespace}:stats:events`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_STATS_ENABLED'] = 'true';
	env[vendor]['CACHE_AUTO_FLUSH_ON_DEPLOY'] = 'false';

	// Once a year: only the stats read drains, and nothing reaps the tables.
	env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '0 0 1 1 *';
	env[vendor]['CACHE_STATS_RETENTION_SCHEDULE'] = '0 0 1 1 *';

	// Its own namespace, over the same database: a stream the truncate leaves.
	const siblingNamespace = `${namespace}-sibling`;
	const siblingStreamName = `${siblingNamespace}:stats:events`;
	const siblingEnv = cloneDeep(env);
	siblingEnv[vendor]['CACHE_NAMESPACE'] = siblingNamespace;

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let database: Knex;
	let instance: ChildProcess;
	let siblingInstance: ChildProcess;
	let lockHolder: Knex.Transaction | undefined;

	beforeAll(async () => {
		database = knex(config.knexConfig[vendor]!);

		await CreateCollections(vendor, {
			collections: [{
				collection,
				fields: [{ field: 'label', type: 'string', meta: {} }],
			}],
		});

		const port = await freePortOfWorker();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);

		const siblingPort = await freePortOfWorker();
		siblingEnv[vendor].PORT = String(siblingPort);

		siblingInstance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: siblingEnv[vendor],
		});

		await awaitDirectusConnection(siblingPort);
	}, 120_000);

	afterAll(async () => {
		// A scenario that failed with the table held would stall every file after.
		if (lockHolder !== undefined && !lockHolder.isCompleted()) {
			await lockHolder.rollback();
		}

		await stopSpawnedInstance(instance);
		await stopSpawnedInstance(siblingInstance);

		for (const key of await redisClient.keys(`${namespace}*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();
		await DeleteCollection(vendor, { collection });
		await database.destroy();
	}, 60_000);

	defineFeature(feature, (scenario) => {
		scenario(
			'a purge queued before a truncate is not stored after it',
			({ given, and, when, then }) => {
				let truncateSent: Promise<request.Response>;

				given(
					'a row created in the collection queued its purge on the stream',
					async () => {
						await request(getUrl(vendor, env))
							.post(`/items/${collection}`)
							.send({ label: 'purged' })
							.set('Authorization', auth)
							.expect(200);

						// The purge leaves on the next flush of the instance's buffer. A
						// loop, as `expect.poll` runs inside a test only.
						const deadline = Date.now() + 10_000;
						let purgeQueued = false;

						while (!purgeQueued && Date.now() < deadline) {
							const entries = await redisClient.xrange(streamName, '-', '+');

							purgeQueued = entries.some(([, fields]) => {
								return fields.includes(collection);
							});

							await sleep(50);
						}

						expect(purgeQueued).toBe(true);
					},
				);

				and('a transaction holds the last table the truncate empties', async () => {
					lockHolder = await database.transaction();

					await lockHolder.raw(
						`LOCK TABLE ${lockedTable} IN ACCESS EXCLUSIVE MODE`,
					);
				});

				when('the stats truncate waits on that table', async () => {
					truncateSent = request(getUrl(vendor, env))
						.post('/utils/cache/stats/truncate')
						.set('Authorization', auth)
						.then((response) => response);

					const deadline = Date.now() + 10_000;
					let truncateWaiting = false;

					while (!truncateWaiting && Date.now() < deadline) {
						const { rows } = await database.raw(
							`SELECT count(*)::int AS waiting FROM pg_locks
							JOIN pg_class ON pg_class.oid = pg_locks.relation
							WHERE pg_class.relname = ? AND NOT pg_locks.granted`,
							[lockedTable],
						);

						truncateWaiting = rows[0].waiting > 0;
						await sleep(50);
					}

					expect(truncateWaiting).toBe(true);
				});

				and('a stats read drains the stream meanwhile', async () => {
					await request(getUrl(vendor, env))
						.get('/utils/cache/anomalies')
						.set('Authorization', auth)
						.expect(200);
				});

				and('the transaction ends', async () => {
					await lockHolder!.commit();
				});

				then('the truncate answered 200', async () => {
					expect((await truncateSent).statusCode).toBe(200);
				});

				and('no purge of the collection is stored', async () => {
					expect(
						await database('directus_cache_stats_purges')
							.where({ collection })
							.select('mode'),
					).toEqual([]);
				});
			},
			60_000,
		);

		scenario(
			'a purge a sibling namespace queued before a truncate is not stored after it',
			({ given, when, and, then }) => {
				given(
					'a row created through the sibling namespace queued its purge on its stream',
					async () => {
						await request(getUrl(vendor, siblingEnv))
							.post(`/items/${collection}`)
							.send({ label: 'purged by the sibling' })
							.set('Authorization', auth)
							.expect(200);

						const deadline = Date.now() + 10_000;
						let purgeQueued = false;

						while (!purgeQueued && Date.now() < deadline) {
							const entries = await redisClient.xrange(
								siblingStreamName,
								'-',
								'+',
							);

							purgeQueued = entries.some(([, fields]) => {
								return fields.includes(collection);
							});

							await sleep(50);
						}

						expect(purgeQueued).toBe(true);
					},
				);

				when('the stats truncate runs', async () => {
					await request(getUrl(vendor, env))
						.post('/utils/cache/stats/truncate')
						.set('Authorization', auth)
						.expect(200);
				});

				and(
					'a stats read on the sibling namespace drains its stream',
					async () => {
						await request(getUrl(vendor, siblingEnv))
							.get('/utils/cache/anomalies')
							.set('Authorization', auth)
							.expect(200);
					},
				);

				then('no purge of the collection is stored', async () => {
					expect(
						await database('directus_cache_stats_purges')
							.where({ collection })
							.select('mode'),
					).toEqual([]);
				});
			},
			60_000,
		);
	});
});
