import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const INDEX_REAP = 'index_reap';
const INDEX_REAP_PINNED = 'index_reap_pinned';
const INDEX_REAP_WINDOW = 'index_reap_window';
const INDEX_REAP_REGISTRY = 'index_reap_registry';
const INDEX_REAP_STRANDED = 'index_reap_stranded';
const cacheStatusHeader = 'x-cache-status';
const cacheTtlSeconds = 8;

const feature = loadFeature('./tests/db/routes/items/cache-index-reap.feature');

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-index-reap-${vendor}`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_TTL'] = `${cacheTtlSeconds}s`;
	env[vendor]['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '* * * * * *';

	// No scope fields, so every read of the collection is filed in its bare set:
	// the one every fill keeps from expiring.
	const bareIndexKey =
		`${namespace}:scoped-cache-index:fingerprint:${INDEX_REAP}:bare`;

	const pinnedIndexKey =
		`${namespace}:scoped-cache-index:fingerprint:${INDEX_REAP_PINNED}:name=`;

	const indexPrefix = `${namespace}:scoped-cache-index:`;

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: INDEX_REAP,
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
				{
					collection: INDEX_REAP_PINNED,
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
				{
					// Held by the cache-index-reap-window hook.
					collection: INDEX_REAP_WINDOW,
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
				{
					collection: INDEX_REAP_REGISTRY,
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
				{
					collection: INDEX_REAP_STRANDED,
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
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

		await DeleteCollection(vendor, { collection: INDEX_REAP });
		await DeleteCollection(vendor, { collection: INDEX_REAP_PINNED });
		await DeleteCollection(vendor, { collection: INDEX_REAP_WINDOW });
		await DeleteCollection(vendor, { collection: INDEX_REAP_REGISTRY });
		await DeleteCollection(vendor, { collection: INDEX_REAP_STRANDED });
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a read that expired leaves the index, a read still cached stays',
			({ given, and, when, then }) => {
				const rowIds = new Map<string, number>();
				let adaMembers: string[] = [];
				let bobMembers: string[] = [];

				function readByName(name: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${INDEX_REAP}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_REAP}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_REAP}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);

						for (const row of created.body.data) {
							rowIds.set(row.name, row.id);
						}
					},
				);

				and('the read of ada is cached, then expires', async () => {
					expect((await readByName('ada')).headers[cacheStatusHeader])
						.toBe('MISS');

					adaMembers = await redisClient.smembers(bareIndexKey);

					expect(adaMembers).not.toEqual([]);

					await new Promise((resolve) => {
						setTimeout(resolve, cacheTtlSeconds * 1000 + 500);
					});
				});

				and('the read of bob is cached', async () => {
					// Polled: a reap removing ada's members as bob fills moves the
					// counter under that fill, which then evicts its entry.
					await expect.poll(async () => {
						return (await readByName('bob')).headers[cacheStatusHeader];
					}, { timeout: 5_000 }).toBe('HIT');

					bobMembers = (await redisClient.smembers(bareIndexKey))
						.filter((member) => !adaMembers.includes(member));

					expect(bobMembers).not.toEqual([]);
				});

				then(`the index of ${INDEX_REAP} names only the read of bob`, async () => {
					await expect.poll(async () => {
						return (await redisClient.smembers(bareIndexKey)).sort();
					}, { timeout: 5_000 }).toEqual([...bobMembers].sort());
				});

				when(
					'the label of bob is written:',
					async (table: Record<string, string>[]) => {
						const updated = await request(getUrl(vendor, env))
							.patch(`/items/${INDEX_REAP}/${rowIds.get('bob')}`)
							.send(table[0])
							.set('Authorization', auth);

						expect(updated.statusCode).toBe(200);
					},
				);

				then(
					'the read of bob is filled again:',
					async (table: Record<string, string>[]) => {
						const refilled = await readByName('bob');

						expect(refilled.headers[cacheStatusHeader]).toBe('MISS');
						expect(refilled.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);
			},
			60_000,
		);

		scenario(
			'a pinned set loses the members of a read that expired',
			({ given, and, then }) => {
				let bobMembers: string[] = [];

				function readByName(name: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${INDEX_REAP_PINNED}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_REAP_PINNED}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_REAP_PINNED}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				and('the read of ada is cached, then expires', async () => {
					expect((await readByName('ada')).headers[cacheStatusHeader])
						.toBe('MISS');

					expect(await redisClient.exists(`${pinnedIndexKey}ada`)).toBe(1);

					await new Promise((resolve) => {
						setTimeout(resolve, cacheTtlSeconds * 1000 + 500);
					});
				});

				and('the read of bob is cached', async () => {
					await expect.poll(async () => {
						return (await readByName('bob')).headers[cacheStatusHeader];
					}, { timeout: 5_000 }).toBe('HIT');

					bobMembers = await redisClient.smembers(`${pinnedIndexKey}bob`);

					expect(bobMembers).not.toEqual([]);
				});

				// Before the set's own TTL, twice CACHE_TTL, could have dropped it.
				then('the index set of ada is gone', async () => {
					await expect.poll(async () => {
						return redisClient.exists(`${pinnedIndexKey}ada`);
					}, { timeout: 5_000 }).toBe(0);
				});

				and('the index set of bob still names the read of bob', async () => {
					expect((await redisClient.smembers(`${pinnedIndexKey}bob`)).sort())
						.toEqual([...bobMembers].sort());
				});
			},
			60_000,
		);

		scenario(
			'a reap between a fill\'s index and its value evicts the entry',
			({ given, when, then }) => {
				const rowIds = new Map<string, number>();
				let heldRead: request.Response;

				function readByName(name: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${INDEX_REAP_WINDOW}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_REAP_WINDOW}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_REAP_WINDOW}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);

						for (const row of created.body.data) {
							rowIds.set(row.name, row.id);
						}
					},
				);

				when(
					'the read of bob is held between its index and its value, until a reap',
					async () => {
						heldRead = await readByName('bob');
					},
				);

				then(
					'the read of bob answers:',
					async (table: Record<string, string>[]) => {
						expect(heldRead.headers[cacheStatusHeader]).toBe(table[0]!.cache);
						expect(heldRead.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					'the label of bob is written:',
					async (table: Record<string, string>[]) => {
						const updated = await request(getUrl(vendor, env))
							.patch(`/items/${INDEX_REAP_WINDOW}/${rowIds.get('bob')}`)
							.send(table[0])
							.set('Authorization', auth);

						expect(updated.statusCode).toBe(200);
					},
				);

				then(
					'the read of bob is filled again:',
					async (table: Record<string, string>[]) => {
						const refilled = await readByName('bob');

						expect(refilled.headers[cacheStatusHeader]).toBe('MISS');
						expect(refilled.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);
			},
			60_000,
		);

		scenario(
			'an index-key set that is gone is named again by the reap',
			({ given, and, when, then }) => {
				const indexKeysKey =
					`${indexPrefix}collection-index-keys:${INDEX_REAP_REGISTRY}`;

				const adaIndexKey =
					`${indexPrefix}fingerprint:${INDEX_REAP_REGISTRY}:name=ada`;

				function readByName(name: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${INDEX_REAP_REGISTRY}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_REAP_REGISTRY}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_REAP_REGISTRY}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				and('the read of ada is cached', async () => {
					expect((await readByName('ada')).headers[cacheStatusHeader])
						.toBe('MISS');

					await expect.poll(async () => {
						return (await readByName('ada')).headers[cacheStatusHeader];
					}, { timeout: 3_000 }).toBe('HIT');
				});

				and(
					`the index-key set of ${INDEX_REAP_REGISTRY} is gone`,
					async () => {
						expect(await redisClient.del(indexKeysKey)).toBe(1);
					},
				);

				// No read fills in between, so only the reap can name it.
				then(
					'the reap names the set of ada in the index-key set again',
					async () => {
						await expect.poll(async () => {
							return redisClient.sismember(indexKeysKey, adaIndexKey);
						}, { timeout: 3_000 }).toBe(1);
					},
				);

				// The index-key set read first: both only count down from here.
				and(
					'the index-key set expires no sooner than the set of ada',
					async () => {
						const indexKeysExpiry = await redisClient.pttl(indexKeysKey);
						const setExpiry = await redisClient.pttl(adaIndexKey);

						expect(setExpiry).toBeGreaterThan(0);
						expect(indexKeysExpiry).toBeGreaterThanOrEqual(setExpiry);
					},
				);

				and('the read of ada is still cached', async () => {
					expect((await readByName('ada')).headers[cacheStatusHeader])
						.toBe('HIT');
				});

				when(
					`every read of ${INDEX_REAP_REGISTRY} is purged`,
					async () => {
						const purged = await request(getUrl(vendor, env))
							.post(`/cache-collection-purge/${INDEX_REAP_REGISTRY}`)
							.set('Authorization', auth);

						expect(purged.statusCode).toBe(200);
					},
				);

				then(
					'the read of ada answers:',
					async (table: Record<string, string>[]) => {
						expect((await readByName('ada')).headers[cacheStatusHeader])
							.toBe(table[0]!.cache);
					},
				);
			},
			60_000,
		);

		scenario(
			oneLine`
				a set an older build moved aside without naming it is released by the
				reap
			`,
			({ given, and, then }) => {
				const sweptKey = `${indexPrefix}swept:${INDEX_REAP_STRANDED}:`
					+ `${randomUUID()}:1`;

				function readByName(name: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${INDEX_REAP_STRANDED}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_REAP_STRANDED}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_REAP_STRANDED}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				and('the read of ada is cached', async () => {
					expect((await readByName('ada')).headers[cacheStatusHeader])
						.toBe('MISS');

					await expect.poll(async () => {
						return (await readByName('ada')).headers[cacheStatusHeader];
					}, { timeout: 3_000 }).toBe('HIT');
				});

				// What the move script of a build before the swept index-key set
				// does: the set renamed away and its name dropped, named nowhere.
				and(
					'a sweep of an older build moved the set of ada aside without naming it',
					async () => {
						expect(await redisClient.rename(
							`${indexPrefix}fingerprint:${INDEX_REAP_STRANDED}:name=ada`,
							sweptKey,
						)).toBe('OK');

						expect(await redisClient.srem(
							`${indexPrefix}collection-index-keys:${INDEX_REAP_STRANDED}`,
							`${indexPrefix}fingerprint:${INDEX_REAP_STRANDED}:name=ada`,
						)).toBe(1);
					},
				);

				// Well inside the entry's 8s: a MISS after it would be its own expiry.
				then('the reap drops the read of ada before it expires', async () => {
					await expect.poll(async () => {
						return (await readByName('ada')).headers[cacheStatusHeader];
					}, { timeout: 4_000 }).toBe('MISS');
				});

				and('the moved set is gone, and nothing names it', async () => {
					expect([
						await redisClient.exists(sweptKey),
						await redisClient.sismember(
							`${indexPrefix}swept-index-keys`,
							sweptKey,
						),
					]).toEqual([0, 0]);
				});
			},
			60_000,
		);

		scenario(
			'a reap marks the index-key sets complete with the index generation',
			({ given, then }) => {
				given('the cache is flushed', async () => {
					const flushed = await request(getUrl(vendor, env))
						.post('/utils/cache/clear')
						.set('Authorization', auth);

					expect(flushed.statusCode).toBe(200);
				});

				// Polled: the flush takes the marker back, and the next reap writes
				// the generation that flush moved.
				then(
					'the next reap marks the index-key sets complete with the generation',
					async () => {
						const generation = await redisClient.get(
							`${namespace}:scoped-cache-index-generation`,
						);

						expect(generation).not.toBeNull();

						await expect.poll(async () => {
							return redisClient.get(
								`${indexPrefix}collection-index-keys-complete`,
							);
						}, { timeout: 5_000 }).toBe(generation);
					},
				);
			},
			60_000,
		);
	});
});
