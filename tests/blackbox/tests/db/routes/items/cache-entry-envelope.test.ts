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
				return !key.endsWith('__expires_at') && !key.endsWith('__pins');
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
				// The fill cost lands on the descriptor, and only with stats on; the
				// audit queues off the same descriptor.
				env[vendor]['CACHE_STATS_ENABLED'] = 'true';
				env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '* * * * * *';

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
				an expiry sidecar written before the change still tells a HIT how long
				it has left
			`, async () => {
				const now = Date.now();
				const key = await entryKey(namespace);

				await redis.set(`${key}__expires_at`, JSON.stringify({
					value: { exp: now + 60_000, createdAt: now, ttlMs: 60_000 },
					expires: now + 60_000,
				}));

				const hit = await readRows(url);

				expect(hit.headers[cacheStatusHeader]).toBe('HIT');
				// An unreadable sidecar answers `no-cache` instead.
				expect(hit.headers['cache-control']).toMatch(/max-age=([1-9]|[1-5]\d|60)\b/);
			});

			it(oneLine`
				the audit replays an entry written before the change, and reads its
				body well enough to name the field the database disagrees on
			`, async () => {
				await request(url)
					.post('/utils/cache/clear')
					.set('Authorization', auth)
					.expect(200);

				const miss = await readRows(url);
				expect(miss.headers[cacheStatusHeader]).toBe('MISS');

				const key = await entryKey(namespace);
				const now = Date.now();
				const before = cloneDeep(miss.body);
				before.data[0].note = 'from-before';

				await redis.set(key, JSON.stringify({
					value: `:base64:${(await snappy(tokenize(before))).toString('base64')}`,
					expires: now + 60_000,
				}));

				await redis.set(`${key}__expires_at`, JSON.stringify({
					value: { exp: now + 60_000, createdAt: now, ttlMs: 60_000 },
					expires: now + 60_000,
				}));

				// An entry the audit cannot decode is `unreplayable`/`unreadable`; a
				// diff on the one field moved is the body read back whole.
				// Bound to the collection: the descriptors are the shard's, and an
				// audit retires every one whose entry its own namespace does not hold
				// — a parallel suite's under another namespace included.
				for (let attempt = 0; attempt < 30; attempt++) {
					const run = await request(url)
						.post('/utils/cache/audit')
						.send({ collection: COLLECTION })
						.set('Authorization', auth)
						.expect(200);

					const report = await request(url)
						.get(`/utils/cache/audits/${run.body.data.id}`)
						.set('Authorization', auth)
						.expect(200);

					const finding = report.body.data.findings.find((candidate: any) => {
						return candidate.url === `/items/${COLLECTION}?sort=label`;
					});

					if (finding) {
						expect(finding).toMatchObject({
							verdict: 'stale',
							diff: ['/data/0/note'],
						});

						return;
					}

					await new Promise((resolve) => setTimeout(resolve, 500));
				}

				throw new Error('the audit never reported the entry');
			}, 60_000);

			it(oneLine`
				an audit run lock left by the previous build is honoured, down to the
				time it was taken
			`, async () => {
				const since = Date.now() - 5_000;
				const [lockKey] = await redis.keys(`${namespace}_lock:*`);
				const lockPrefix = lockKey!.slice(0, lockKey!.lastIndexOf(':') + 1);

				await redis.set(`${lockPrefix}cache-audit:run`, JSON.stringify({
					value: since,
					expires: since + 120_000,
				}));

				try {
					const refused = await request(url)
						.post('/utils/cache/audit')
						.send({ collection: COLLECTION })
						.set('Authorization', auth);

					expect(refused.statusCode).toBe(503);

					expect(refused.body.errors[0].message).toContain(
						new Date(since).toISOString(),
					);
				}
				finally {
					await redis.del(`${lockPrefix}cache-audit:run`);
				}
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

		// The build identity is the one key `flushCaches` keeps, so on every
		// deploy the new build reads what the old one stored through the old
		// envelope — misread, every boot would flush.
		describe('the build identity the previous build stored', () => {
			const namespace = `directus-envelope-identity-${vendor}`;
			let env: ReturnType<typeof instanceEnv>;
			let identityKey: string;
			let identity: string;

			async function bootAndRead() {
				const instance = await boot(env);

				try {
					return await readRows(getUrl(vendor, env));
				}
				finally {
					instance.kill();
				}
			}

			beforeAll(async () => {
				env = instanceEnv(namespace);
				const instance = await boot(env);
				const url = getUrl(vendor, env);

				await request(url)
					.post('/utils/cache/clear')
					.set('Authorization', auth)
					.expect(200);

				await readRows(url);
				const hit = await readRows(url);
				expect(hit.headers[cacheStatusHeader]).toBe('HIT');

				instance.kill();

				const lockKeys = await redis.keys(`${namespace}_lock:*`);
				identityKey = lockKeys.find((key) => key.endsWith(':build-identity'))!;
				expect(identityKey).toBeDefined();

				const raw = await redis.get(identityKey);
				expect(raw).toMatch(/^\{"envelope":2,"value":"/);
				identity = JSON.parse(raw!).value;
			}, 60_000);

			it(oneLine`
				a node booting on an identity the old envelope stored reads it as its
				own, and keeps the cache
			`, async () => {
				await redis.set(identityKey, JSON.stringify({ value: identity }));

				const read = await bootAndRead();

				expect(read.headers[cacheStatusHeader]).toBe('HIT');

				// Left as it was: a matching identity is not rewritten.
				expect(await redis.get(identityKey)).toBe(
					JSON.stringify({ value: identity }),
				);
			}, 60_000);

			it(oneLine`
				and flushes on one that names another build, then stores its own
			`, async () => {
				await redis.set(identityKey, JSON.stringify({
					value: `${identity}-previous-build`,
				}));

				const read = await bootAndRead();

				expect(read.headers[cacheStatusHeader]).toBe('MISS');

				expect(JSON.parse((await redis.get(identityKey))!)).toEqual({
					envelope: 2,
					value: identity,
				});
			}, 60_000);
		});
		});
	});
});
