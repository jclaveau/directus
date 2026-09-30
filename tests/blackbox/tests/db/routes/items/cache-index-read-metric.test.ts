import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, vi } from 'vitest';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-index-read-metric.feature',
);

// The purges come from the cache-collection-purge extension: a row handed over
// without its primary key leaves the purge nothing to bind, so it drops every
// read of the collection.
describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-index-read-metric-${vendor}`;
	const markerKey = `${namespace}:scoped-cache-collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;
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
	env[vendor]['METRICS_ENABLED'] = 'true';

	const collections = ['index_read_metric_scan', 'index_read_metric_registry'];
	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

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

		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));

		// Waited for once, so the pass the boot asked for cannot write the marker
		// back over one a scenario dropped.
		// Outside a test, where expect.poll refuses to run.
		await vi.waitFor(async () => {
			const [marker, generation] = await redisClient.mget(
				markerKey,
				generationKey,
			);

			expect(marker).not.toBeNull();
			expect(marker).toBe(generation);
		}, { timeout: 15_000, interval: 250 });
	}, 75_000);

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

	// A counter no read incremented yet is absent from the exposition: 0.
	async function countedIndexReads(): Promise<Record<string, number>> {
		const exposed = await request(getUrl(vendor, env))
			.get('/metrics')
			.set('Authorization', auth);

		expect(exposed.statusCode).toBe(200);

		const counted: Record<string, number> = { scan: 0, registry: 0 };

		for (const [, mode, count] of exposed.text.matchAll(
			/^directus_scoped_cache_index_reads_total\{mode="(\w+)"\} (\d+)$/gm,
		)) {
			counted[mode!] = Number(count);
		}

		return counted;
	}

	defineFeature(feature, (scenario) => {
		for (const scenarioTitle of [
			'a purge while the index-key sets are not marked complete counts a scan',
			'a purge once the index-key sets are marked complete counts a registry '
				+ 'read',
		]) {
			scenario(scenarioTitle, ({ given, and, when, then }) => {
				let collection = '';
				let countedBefore: Record<string, number> = {};
				let countedAfter: Record<string, number> = {};

				function readByName(row: Record<string, string>) {
					return request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({ 'filter[name][_eq]': row['name'], fields: row['fields'] })
						.set('Authorization', auth);
				}

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

				and('these reads are cached:', async (table: Record<string, string>[]) => {
					for (const row of table) {
						expect((await readByName(row)).headers[cacheStatusHeader])
							.toBe('MISS');

						// The fill lands after the response.
						await expect.poll(async () => {
							return (await readByName(row)).headers[cacheStatusHeader];
						}, { timeout: 5_000 }).toBe('HIT');
					}
				});

				and.optional(
					'the index-key sets are not marked complete',
					async () => {
						await redisClient.del(markerKey);
						expect(await redisClient.exists(markerKey)).toBe(0);
					},
				);

				// What a reap's full pass writes: the index generation as it read
				// before the pass.
				and.optional('the index-key sets are marked complete', async () => {
					expect(await redisClient.set(
						markerKey,
						(await redisClient.get(generationKey))!,
					)).toBe('OK');
				});

				// Read on each side of the purge alone: the fills and row writes
				// before it read no collection-wide index.
				when(/^every read of \w+ is purged$/, async () => {
					countedBefore = await countedIndexReads();

					const purged = await request(getUrl(vendor, env))
						.post(`/cache-collection-purge/${collection}`)
						.set('Authorization', auth);

					expect(purged.statusCode).toBe(200);
					countedAfter = await countedIndexReads();
				});

				then(
					'the index reads the purge counted grew:',
					(table: Record<string, string>[]) => {
						for (const { mode, grew } of table) {
							if (grew === 'yes') {
								expect(countedAfter[mode!]).toBeGreaterThan(countedBefore[mode!]!);
							}
							else {
								expect(countedAfter[mode!]).toBe(countedBefore[mode!]);
							}
						}
					},
				);

				and('these reads answer:', async (table: Record<string, string>[]) => {
					for (const row of table) {
						expect((await readByName(row)).headers[cacheStatusHeader])
							.toBe(row['cache']);
					}
				});
			}, 60_000);
		}
	});
});
