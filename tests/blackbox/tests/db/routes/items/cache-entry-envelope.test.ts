import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { createRedisProxy } from '@common/redis-proxy';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { compress as tokenize } from '@directus/utils/values';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import { compress as snappy, uncompress as unsnappy } from 'snappy';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// What Redis holds for a cached response, and what a HIT reads back from it
// (#520). The Keyv envelope used to be `@keyv/serialize`'s, whose reader runs a
// reviver on every value of the document; the payload under it used to be
// tokenized before snappy. Both are gone, and an entry either wrote is still
// read for the deploy window in which both shapes coexist.

const COLLECTION = 'cache_entry_envelope';
const DESCRIPTORS = 'directus_cache_stats_descriptors';
const SET_DELAY_MS = 400;
const cacheStatusHeader = 'x-cache-status';

// The strings the old envelope escaped, and the marker it used for a Buffer:
// stored as they are now, and read back as they were then.
const ROWS = [
	{ label: 'a', note: ':leading' },
	{ label: 'b', note: '::double' },
	{ label: 'c', note: ':base64:notreally' },
];

describe('a cached response is stored in the fork\'s envelope (#520)', () => {
	describe.each(vendors)('%s', (vendor) => {
		const redis = new Redis({ host: 'localhost', port: 6108 });
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		let db: Knex;

		function instanceEnv(namespace: string) {
			const env = cloneDeep(config.envs);
			env[vendor]['CACHE_ENABLED'] = 'true';
			env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			env[vendor]['CACHE_STORE'] = 'redis';
			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = '6108';
			env[vendor]['CACHE_NAMESPACE'] = namespace;
			return env;
		}

		async function boot(env: ReturnType<typeof instanceEnv>) {
			const port = await getPort();
			env[vendor].PORT = String(port);

			const instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);

			return instance;
		}

		// The one key under the namespace that is neither sidecar: the entry.
		async function entryKey(namespace: string): Promise<string> {
			const keys = await redis.keys(`${namespace}_response:*`);

			const entries = keys.filter((key) => {
				return !key.endsWith('__expires_at') && !key.endsWith('__tags');
			});

			expect(entries).toHaveLength(1);

			return entries[0]!;
		}

		// The query inline rather than through `.query()`, which percent-encodes
		// the brackets: the descriptor keeps the string as sent, and is looked
		// up by it.
		function readRows(url: string, query = 'sort=label') {
			return request(url)
				.get(`/items/${COLLECTION}?${query}`)
				.set('Authorization', auth);
		}

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: COLLECTION,
					fields: [
						{ field: 'label', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, { collection: COLLECTION, item: ROWS });

			db = knex(config.knexConfig[vendor]!);
		}, 60_000);

		afterAll(async () => {
			await db.destroy();
			redis.disconnect();
			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		describe('compressed (the default)', () => {
			const namespace = `directus-envelope-snappy-${vendor}`;
			let proxy: ReturnType<typeof createRedisProxy>;
			let instance: ChildProcess;
			let url: string;

			beforeAll(async () => {
				const proxyPort = await getPort();
				proxy = createRedisProxy(6108, proxyPort);
				await proxy.open();

				const env = instanceEnv(namespace);
				env[vendor]['REDIS_PORT'] = String(proxyPort);
				// The fill cost lands on the descriptor, and only with stats on.
				env[vendor]['CACHE_STATS_ENABLED'] = 'true';

				instance = await boot(env);
				url = getUrl(vendor, env);

				await request(url)
					.post('/utils/cache/clear')
					.set('Authorization', auth)
					.expect(200);
			}, 60_000);

			afterAll(async () => {
				instance?.kill();
				await proxy.cut();
			});

			it(oneLine`
				a HIT serves what the MISS did, and knows how long it has left
			`, async () => {
				const miss = await readRows(url);
				expect(miss.headers[cacheStatusHeader]).toBe('MISS');

				expect(miss.body.data.map((row: any) => row.note)).toEqual(
					ROWS.map((row) => row.note),
				);

				const hit = await readRows(url);
				expect(hit.headers[cacheStatusHeader]).toBe('HIT');
				expect(hit.body).toEqual(miss.body);

				// Off the `__expires_at` sidecar, read through the same envelope: an
				// unreadable one answers `no-cache` instead.
				expect(hit.headers['cache-control']).toMatch(/max-age=\d+/);
			});

			it(oneLine`
				Redis holds one JSON document led by the envelope version, the payload
				as base64 of snappy over its JSON text — no tokenizer in between
			`, async () => {
				const { body } = await readRows(url);

				const raw = await redis.get(await entryKey(namespace));

				expect(raw).toMatch(/^\{"envelope":2,"base64":"/);

				const stored = JSON.parse(raw!);

				const text = await unsnappy(Buffer.from(stored.base64, 'base64'), {
					asBuffer: false,
				});

				expect(JSON.parse(text as string)).toEqual(body);
				expect(stored.expires).toBeGreaterThan(Date.now());
			});

			it('the expiry sidecar is the same envelope over three numbers', async () => {
				await readRows(url);

				const raw = await redis.get(`${await entryKey(namespace)}__expires_at`);

				expect(raw).toMatch(/^\{"envelope":2,"value":\{"exp":\d+,"createdAt":\d+,"ttlMs":\d+\},"expires":\d+\}$/);
			});

			it(oneLine`
				an entry written before the change — the old envelope over a tokenized
				payload — is still served for the deploy window
			`, async () => {
				const key = await entryKey(namespace);
				const legacy = { data: [{ id: 0, label: 'legacy', note: ':from-before' }] };
				const payload = await snappy(tokenize(legacy));

				await redis.set(key, JSON.stringify({
					value: `:base64:${payload.toString('base64')}`,
					expires: Date.now() + 60_000,
				}));

				const hit = await readRows(url);

				expect(hit.headers[cacheStatusHeader]).toBe('HIT');
				expect(hit.body).toEqual(legacy);
			});

			it(oneLine`
				the fill cost on the descriptor counts the write of the entry, so a slow
				Redis shows on the miss it slowed
			`, async () => {
				const query = 'sort=label&filter[label][_eq]=a';

				proxy.delaySets(SET_DELAY_MS);

				try {
					const miss = await readRows(url, query);
					expect(miss.headers[cacheStatusHeader]).toBe('MISS');
				}
				finally {
					proxy.delaySets(0);
				}

				// The stats stream drains on a ten-second cron, so the row lands some
				// ticks after the request that filled.
				for (let attempt = 0; attempt < 40; attempt++) {
					const row = await db(DESCRIPTORS)
						.where({
							collection: COLLECTION,
							path: `/items/${COLLECTION}`,
							query,
						})
						.select('fill_ms')
						.first();

					if (row) {
						expect(Number(row['fill_ms'])).toBeGreaterThanOrEqual(SET_DELAY_MS);
						return;
					}

					await new Promise((resolve) => setTimeout(resolve, 1000));
				}

				throw new Error('no descriptor was recorded for the delayed fill');
			}, 60_000);
		});

		describe('uncompressed (CACHE_COMPRESSION_ENABLED=false)', () => {
			const namespace = `directus-envelope-plain-${vendor}`;
			let instance: ChildProcess;
			let url: string;

			beforeAll(async () => {
				const env = instanceEnv(namespace);
				env[vendor]['CACHE_COMPRESSION_ENABLED'] = 'false';

				instance = await boot(env);
				url = getUrl(vendor, env);

				await request(url)
					.post('/utils/cache/clear')
					.set('Authorization', auth)
					.expect(200);
			}, 60_000);

			afterAll(() => {
				instance?.kill();
			});

			it(oneLine`
				Redis holds the payload readable, its strings as they are — no escape
				on a leading colon
			`, async () => {
				const miss = await readRows(url);
				expect(miss.headers[cacheStatusHeader]).toBe('MISS');

				const raw = await redis.get(await entryKey(namespace));

				expect(raw).toMatch(/^\{"envelope":2,"value":\{"data":\[/);
				expect(JSON.parse(raw!).value).toEqual(miss.body);

				const hit = await readRows(url);
				expect(hit.headers[cacheStatusHeader]).toBe('HIT');
				expect(hit.body).toEqual(miss.body);
			});

			it(oneLine`
				an entry written before the change — its leading colons escaped by one
				more — reads back unescaped
			`, async () => {
				const key = await entryKey(namespace);

				await redis.set(key, JSON.stringify({
					value: { data: [{ id: 0, label: 'legacy', note: '::from-before' }] },
					expires: Date.now() + 60_000,
				}));

				const hit = await readRows(url);

				expect(hit.headers[cacheStatusHeader]).toBe('HIT');
				expect(hit.body.data[0].note).toBe(':from-before');
			});
		});
	});
});
