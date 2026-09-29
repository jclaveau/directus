import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const STRANDED = 'stranded_sweep';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature('./tests/db/routes/items/cache-stranded-sweep.feature');

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-stranded-sweep-${vendor}`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	async function startInstance() {
		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection: STRANDED,
				meta: { scoped_cache_fields: ['name'] },
				fields: [
					{ field: 'name', type: 'string', meta: {} },
					{ field: 'label', type: 'string', meta: {} },
				],
			}],
		});

		env[vendor].PORT = String(await getPort());

		await startInstance();
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();

		await DeleteCollection(vendor, { collection: STRANDED });
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a read whose index set a dead sweep moved aside is purged on restart',
			({ given, and, when, then }) => {
				const rowIds = new Map<string, number>();

				function readByName(name: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${STRANDED}`)
						.query({ 'filter[name][_eq]': name, fields: 'name,label' })
						.set('Authorization', auth);
				}

				given(
					`these rows of ${STRANDED}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${STRANDED}`)
							.send(table)
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);

						for (const row of created.body.data) {
							rowIds.set(row.name, row.id);
						}
					},
				);

				and(
					'these reads are cached:',
					async (table: Record<string, string>[]) => {
						for (const { name, response } of table) {
							expect((await readByName(name!)).headers[cacheStatusHeader])
								.toBe('MISS');

							const cached = await readByName(name!);

							expect(cached.headers[cacheStatusHeader]).toBe('HIT');
							expect(cached.body.data).toEqual(loadYaml(response!));
						}
					},
				);

				// What the sweep's move script does, under the key it moves to: the
				// set renamed away from the one every write reads, its name moved from
				// the collection's index-key set to the swept one.
				and(
					'a sweep moved the index set of this name aside, then died:',
					async (table: Record<string, string>[]) => {
						const indexKey = `${namespace}:scoped-cache-index:fingerprint:`
							+ `${STRANDED}:name=${table[0]!.name}`;

						const sweptKey = `${namespace}:scoped-cache-index:swept:`
							+ `${STRANDED}:${randomUUID()}:1`;

						expect(await redisClient.rename(indexKey, sweptKey)).toBe('OK');

						await redisClient.srem(
							`${namespace}:scoped-cache-index:collection-index-keys:${STRANDED}`,
							indexKey,
						);

						await redisClient.sadd(
							`${namespace}:scoped-cache-index:swept-index-keys`,
							sweptKey,
						);
					},
				);

				when(
					'the label of ada is written:',
					async (table: Record<string, string>[]) => {
						const updated = await request(getUrl(vendor, env))
							.patch(`/items/${STRANDED}/${rowIds.get('ada')}`)
							.send(table[0])
							.set('Authorization', auth);

						expect(updated.statusCode).toBe(200);
					},
				);

				and('the process restarts', async () => {
					const exited = new Promise((resolve) => instance.once('exit', resolve));
					instance.kill();
					await exited;

					await startInstance();
				});

				then(
					'these reads answer:',
					async (table: Record<string, string>[]) => {
						for (const { name, cache, response } of table) {
							// The release runs beside the boot, not before it answers.
							await expect.poll(async () => {
								return (await readByName(name!)).headers[cacheStatusHeader];
							}, { timeout: 10_000 }).toBe(cache);

							expect((await readByName(name!)).body.data)
								.toEqual(loadYaml(response!));
						}
					},
				);
			},
			120_000,
		);
	});
});
