import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const INDEX_PRUNE = 'index_prune';
const INDEX_PRUNE_PINNED = 'index_prune_pinned';
const INDEX_PRUNE_WINDOW = 'index_prune_window';
const cacheStatusHeader = 'x-cache-status';
const cacheTtlSeconds = 8;

// A member is filed to expire twice CACHE_TTL out, and its set with it.
const indexExpiryMs = cacheTtlSeconds * 2 * 1000 + 500;

const feature = loadFeature('./tests/db/routes/items/cache-index-prune.feature');

function waitIndexExpiry() {
	return new Promise((resolve) => {
		setTimeout(resolve, indexExpiryMs);
	});
}

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-index-prune-${vendor}`;
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

	// Scoped on label, read by primary key: every read is filed in the bare set
	// and pinned to its row, so a write to another row leaves it cached.
	const bareIndexKey =
		`${namespace}:scoped-cache-index:fingerprint-expiry:${INDEX_PRUNE}:`;

	const pinnedIndexKey = `${namespace}:scoped-cache-index:`
		+ `fingerprint-expiry:${INDEX_PRUNE_PINNED}:name=`;

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: INDEX_PRUNE,
					meta: { scoped_cache_fields: ['label'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
				{
					collection: INDEX_PRUNE_PINNED,
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				},
				{
					// Held by the cache-index-prune-window hook.
					collection: INDEX_PRUNE_WINDOW,
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

		await DeleteCollection(vendor, { collection: INDEX_PRUNE });
		await DeleteCollection(vendor, { collection: INDEX_PRUNE_PINNED });
		await DeleteCollection(vendor, { collection: INDEX_PRUNE_WINDOW });
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
						.get(`/items/${INDEX_PRUNE}`)
						.query({
							'filter[id][_eq]': rowIds.get(name),
							fields: 'name,label',
						})
						.set('Authorization', auth);
				}

				function writeLabel(name: string, payload: Record<string, string>) {
					return request(getUrl(vendor, env))
						.patch(`/items/${INDEX_PRUNE}/${rowIds.get(name)}`)
						.send(payload)
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_PRUNE}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_PRUNE}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);

						for (const row of created.body.data) {
							rowIds.set(row.name, row.id);
						}
					},
				);

				and(
					'the read of ada is cached, then its index members expire',
					async () => {
						expect((await readByName('ada')).headers[cacheStatusHeader])
							.toBe('MISS');

						adaMembers = await redisClient.zrange(bareIndexKey, 0, -1);

						expect(adaMembers).not.toEqual([]);

						await waitIndexExpiry();
					},
				);

				and('the read of bob is cached', async () => {
					expect((await readByName('bob')).headers[cacheStatusHeader])
						.toBe('MISS');

					bobMembers = (await redisClient.zrange(bareIndexKey, 0, -1))
						.filter((member) => !adaMembers.includes(member));

					expect(bobMembers).not.toEqual([]);
				});

				when(
					'the label of cy is written:',
					async (table: Record<string, string>[]) => {
						expect((await writeLabel('cy', table[0]!)).statusCode).toBe(200);
					},
				);

				then(`the index of ${INDEX_PRUNE} names only the read of bob`, async () => {
					expect((await redisClient.zrange(bareIndexKey, 0, -1)).sort())
						.toEqual([...bobMembers].sort());
				});

				and(
					'the read of bob answers:',
					async (table: Record<string, string>[]) => {
						const cached = await readByName('bob');

						expect(cached.headers[cacheStatusHeader]).toBe(table[0]!.cache);
						expect(cached.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					'the label of bob is written:',
					async (table: Record<string, string>[]) => {
						expect((await writeLabel('bob', table[0]!)).statusCode).toBe(200);
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
						.get(`/items/${INDEX_PRUNE_PINNED}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_PRUNE_PINNED}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_PRUNE_PINNED}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				and(
					'the read of ada is cached, then its index members expire',
					async () => {
						expect((await readByName('ada')).headers[cacheStatusHeader])
							.toBe('MISS');

						expect(await redisClient.exists(`${pinnedIndexKey}ada`)).toBe(1);

						await waitIndexExpiry();
					},
				);

				and('the read of bob is cached', async () => {
					expect((await readByName('bob')).headers[cacheStatusHeader])
						.toBe('MISS');

					bobMembers = await redisClient
						.zrange(`${pinnedIndexKey}bob`, 0, -1);

					expect(bobMembers).not.toEqual([]);
				});

				then('the index set of ada is gone', async () => {
					expect(await redisClient.exists(`${pinnedIndexKey}ada`)).toBe(0);
				});

				and('the index set of bob still names the read of bob', async () => {
					expect(await redisClient.zrange(`${pinnedIndexKey}bob`, 0, -1))
						.toEqual(bobMembers);
				});
			},
			60_000,
		);

		scenario(
			'a fill held past its index\'s expiry evicts the entry',
			({ given, when, then, and }) => {
				let heldRead: request.Response;

				function readByName(name: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${INDEX_PRUNE_WINDOW}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${INDEX_PRUNE_WINDOW}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${INDEX_PRUNE_WINDOW}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				when(
					'the read of bob is held between its index and its value, past one TTL',
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

				// Written just now, the entry would still be live: a MISS is the eviction.
				and(
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
	});
});
