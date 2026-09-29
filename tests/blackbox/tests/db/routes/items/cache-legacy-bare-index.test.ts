import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { awaitRequestedReap } from '@utils/await-requested-reap';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-legacy-bare-index.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-legacy-bare-index-${vendor}`;
	const indexPrefix = `${namespace}:scoped-cache-index:`;
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

	// Once a year: a reap adopting a collection stops its writes reading the
	// legacy bare set, which the last scenario needs them to. The pass the boot
	// asks for ends before any scenario files a read.
	env[vendor]['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '0 0 1 1 *';

	const collections = [
		'legacy_bare_named',
		'legacy_bare_old_write',
		'legacy_bare_new_write',
		'legacy_bare_old_fill',
	];

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

		await awaitRequestedReap(6108, namespace);
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		for (const key of await redisClient.keys(`${namespace}*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();

		for (const collection of collections) {
			await DeleteCollection(vendor, { collection });
		}
	});

	defineFeature(feature, (scenario) => {
		for (const scenarioTitle of [
			'a read filed under its home pin is named in the legacy bare set',
			'an older build\'s write drops a read filed under its home pin',
			'a newer build\'s write leaves no dead entry in the legacy bare set',
			'a newer build\'s write drops a read only an older build named',
		]) {
			scenario(scenarioTitle, ({ given, and, when, then }) => {
				let collection = '';
				const rowIds = new Map<string, number>();

				function legacyBareKey() {
					return `${indexPrefix}fingerprint:${collection}:`;
				}

				// The one home pin set the read of ada is filed under, its key the
				// row's primary key.
				async function homePinKey() {
					const homePinKeys = await redisClient.keys(
						`${indexPrefix}fingerprint:${collection}:pin:*`,
					);

					expect(homePinKeys).toHaveLength(1);

					return homePinKeys[0]!;
				}

				function readById(row: Record<string, string>) {
					return request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.query({
							'filter[id][_eq]': rowIds.get(row['name']!),
							fields: row['fields'],
						})
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

						for (const createdRow of created.body.data) {
							rowIds.set(createdRow.name, createdRow.id);
						}
					},
				);

				and(
					'these reads are cached:',
					async (table: Record<string, string>[]) => {
						for (const row of table) {
							expect((await readById(row)).headers[cacheStatusHeader])
								.toBe('MISS');

							// The fill lands after the response.
							await expect.poll(async () => {
								return (await readById(row)).headers[cacheStatusHeader];
							}, { timeout: 5_000 }).toBe('HIT');
						}
					},
				);

				// What a trunk fill leaves: the read named in the legacy bare set
				// alone.
				and.optional(
					'the home pin set is gone, as an older build files the read',
					async () => {
						expect(await redisClient.del(await homePinKey())).toBe(1);
					},
				);

				// What a row write of an older build does: read the legacy bare set,
				// and unlink every entry it names, sidecars included.
				when.optional(
					'an older build drops every entry the legacy bare set names',
					async () => {
						const [scanCursor, legacyMembers] = await redisClient.sscan(
							legacyBareKey(),
							'0',
							'COUNT',
							1000,
						);

						expect(scanCursor).toBe('0');
						expect(legacyMembers).toHaveLength(1);

						const entryKey = legacyMembers[0]!
							.slice(legacyMembers[0]!.indexOf('|') + 1);

						const namedKeys = (await redisClient.keys(`${namespace}_*`))
							.filter((cachedKey) => cachedKey.includes(entryKey));

						expect(namedKeys.length).toBeGreaterThan(0);

						expect(await redisClient.unlink(...namedKeys))
							.toBe(namedKeys.length);
					},
				);

				when.optional('the row of ada is written', async () => {
					const written = await request(getUrl(vendor, env))
						.patch(`/items/${collection}/${rowIds.get('ada')}`)
						.send({ label: 'new' })
						.set('Authorization', auth);

					expect(written.statusCode).toBe(200);
				});

				then.optional(
					'the legacy bare set names what the home pin set does',
					async () => {
						const homePinMembers = await redisClient.smembers(
							await homePinKey(),
						);

						expect(homePinMembers).toHaveLength(1);

						expect(await redisClient.smembers(legacyBareKey()))
							.toEqual(homePinMembers);
					},
				);

				then.optional('the legacy bare set names nothing', async () => {
					expect(await redisClient.smembers(legacyBareKey())).toEqual([]);
				});

				then.optional(
					'these reads answer:',
					async (table: Record<string, string>[]) => {
						for (const row of table) {
							expect((await readById(row)).headers[cacheStatusHeader])
								.toBe(row['cache']);
						}
					},
				);
			}, 60_000);
		}
	});
});
