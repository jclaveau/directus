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

const INDEX_REAP = 'index_reap';
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
		`${namespace}:scoped-cache-index:fingerprint:${INDEX_REAP}:`;

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection: INDEX_REAP,
				fields: [
					{ field: 'name', type: 'string', meta: {} },
					{ field: 'label', type: 'string', meta: {} },
				],
			}],
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
	});
});
