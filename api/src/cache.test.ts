import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import type { ScopedCacheDeclaredFingerprint } from '@directus/types';
import type Keyv from 'keyv';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	onTestFinished,
	test,
	vi,
} from 'vitest';

// cache.ts captures `const env = useEnv()` at module load, so mutate one shared object
// (never reassign) to keep that reference and getConfigFromEnv's useEnv() in sync.
const mockEnv = vi.hoisted(() => ({ current: {} as Record<string, any> }));
const env = mockEnv.current;

const redis = vi.hoisted(() => {
	const pipeline = {
		sadd: vi.fn(),
		expire: vi.fn(),
		eval: vi.fn(),
		srem: vi.fn(),
		scopedCacheTagExpiry: vi.fn(),
		incr: vi.fn(),
		sunion: vi.fn(),
		unlink: vi.fn(),
		exec: vi.fn(),
	};

	return {
		isCluster: false,
		defineCommand: vi.fn(),
		smembers: vi.fn(),
		sscan: vi.fn(
			async (..._args: string[]): Promise<[string, string[]]> => ['0', []],
		),
		srem: vi.fn(),
		eval: vi.fn(),
		// What the sweep double drops through, standing in for the script's UNLINK.
		unlink: vi.fn(),
		scan: vi.fn(
			async (..._args: string[]): Promise<[string, string[]]> => ['0', []],
		),
		get: vi.fn(async (): Promise<string | null> => '1'),
		set: vi.fn(),
		pipeline: vi.fn(() => pipeline),
		_pipeline: pipeline,
	};
});

// Passthrough filter by default; individual tests override to assert extension
// augmentation.
// The only filter the code under test emits is `cache.purge`, whose payload is
// the fingerprint list, so the stand-in says so rather than taking an `unknown`.
const emitFilter = vi.hoisted(() => {
	return vi.fn(async (
		_event: string,
		payload: ScopedCacheDeclaredFingerprint[],
	) => payload);
});

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv.current }));
// Held rather than built per call: `cache.ts` captures the bus once at module load,
// so a test that needs the publish to fail has to own the same function it captured.
const busPublish = vi.hoisted(() => vi.fn());

// Subscribed once, at module load, so `clearAllMocks` wipes the calls that carried
// the handlers long before a test asks for one. Held by channel so a test can drive
// the subscriber side too.
const busHandlers = vi.hoisted(() => {
	return {} as Record<string, (payload: any) => Promise<void>>;
});

vi.mock('./bus/index.js', () => {
	return {
		useBus: () => {
			return {
				subscribe: vi.fn((channel: string, handler: any) => {
					busHandlers[channel] = handler;
				}),
				publish: busPublish,
			};
		},
	};
});

const logger = vi.hoisted(() => {
	return { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
});

vi.mock('./logger/index.js', () => ({ useLogger: () => logger }));

vi.mock('./emitter.js', () => ({ default: { emitFilter } }));

// flushCaches() clears the permission cache too; orthogonal to the cache layers.
// Held, because one case needs it to fail: it is a `@directus/memory` multi cache
// wired straight to ioredis, so unlike the Keyv tiers it really does reject.
const clearPermissionCache = vi.hoisted(() => vi.fn());

vi.mock('./permissions/cache.js', () => ({ clearCache: clearPermissionCache }));

// Everything else in the module stays real: only the purge emitter is watched,
// because recording the purge is the one thing it does that leaves no other
// trace on redis or the cache to assert against.
const queueCachePurge = vi.hoisted(() => vi.fn());

vi.mock('./cache-events.js', async (importOriginal) => {
	return {
		...(await importOriginal() as object),
		queueCachePurge,
	};
});

vi.mock('./redis/index.js', () => {
	return {
		redisConfigAvailable: () => true,
		useRedis: () => redis,
	};
});

const {
	clearCacheTargets,
	clearSystemCache,
	flushCaches,
	getCache,
	getRedisConnection,
} = await import('./cache.js');

// Snapshotted here: a later case re-imports cache.ts behind `vi.resetModules()`,
// and that copy's subscriber overwrites the shared record with handlers closing
// over its own cache singletons rather than the ones `getCache` above returns.
const cacheHandlers = { ...busHandlers };

const {
	assertScopedCacheStoreSupported,
	indexScopedCacheEntry,
	purgeScopedCache,
	scopedCacheFingerprintOf,
	scopedCachePurgeEnabled,
} = await import('./scoped-cache/index.js');

function setEnv(values: Record<string, unknown>) {
	for (const key of Object.keys(mockEnv.current)) {
		delete mockEnv.current[key];
	}

	Object.assign(mockEnv.current, values);
}

afterEach(() => {
	vi.clearAllMocks();

	// Implementations survive `clearAllMocks`, so one case reaching for
	// `mockRejectedValue` rather than its `Once` form leaves the shared stand-in
	// rejecting for every case after it.
	redis.scan.mockImplementation(async () => ['0', []] as [string, string[]]);
	redis.get.mockImplementation(async () => '1');
});

// `clearAllMocks` drops implementations as well as calls, so the pipeline is armed
// per test: chainable, and `exec` resolving because the epoch bump hangs its own
// `.catch` off the returned promise.
//
// A purge reads its members with one `SUNION` over every pin key, queued on that
// same pipeline. The double answers it as the union of the per-key `smembers` a
// case arms, which is what the command does — so a case still says which pin sets
// hold what, and still sees the purge ask for them.
beforeEach(() => {
	redis._pipeline.sadd.mockReturnValue(redis._pipeline);
	redis._pipeline.expire.mockReturnValue(redis._pipeline);

	// Answers a flush's unlinks with what was queued since the last exec — a real
	// `pipeline()` hands back a fresh queue every call, and the epoch bump execs its
	// own before the unlinks are queued — and an epoch bump alone with nothing.
	let executed = 0;

	redis._pipeline.exec.mockImplementation(async () => {
		const queued = redis._pipeline.unlink.mock.calls.slice(executed);
		executed = redis._pipeline.unlink.mock.calls.length;

		return queued.map(([keys]) => [null, keys.length]);
	});

	// The sweep is one script, so the double runs what the script runs: read each pin
	// set, drop them all, prune the slice index. It reads through `redis.smembers` and
	// writes through `redis.unlink`/`redis.srem` so a case still arms which set holds
	// what, and still sees the sweep ask for and drop exactly those.
	redis.eval.mockImplementation(
		async (_script: string, numKeys: number, ...args: string[]) => {
			const tagKeys = args.slice(0, numKeys);
			const prunings = args.slice(numKeys);

			const memberLists = await Promise.all(
				tagKeys.map((key) => redis.smembers(key)),
			);

			await redis.unlink(tagKeys);

			for (let at = 0; at < prunings.length; at += 2) {
				await redis.srem(prunings[at], prunings[at + 1]);
			}

			return [...new Set(memberLists.flat())];
		},
	);
});

describe('getRedisConnection', () => {
	beforeEach(() => setEnv({}));

	test(oneLine`
		passes a REDIS connection URL through unchanged (@keyv/redis v5 accepts URLs)
	`, () => {
		setEnv({ REDIS: 'redis://localhost:6379/2' });
		expect(getRedisConnection()).toBe('redis://localhost:6379/2');
	});

	test(oneLine`
		translates ioredis-shaped REDIS_HOST/REDIS_PORT to node-redis socket options
	`, () => {
		setEnv({ REDIS_HOST: 'localhost', REDIS_PORT: '6108' });
		expect(getRedisConnection()).toEqual({ socket: { host: 'localhost', port: 6108 } });
	});

	test('maps username/password/db and a TLS flag', () => {
		setEnv({
			REDIS_HOST: 'h',
			REDIS_PORT: '6379',
			REDIS_USERNAME: 'u',
			REDIS_PASSWORD: 'p',
			REDIS_DB: '3',
			REDIS_TLS: true,
		});

		expect(getRedisConnection()).toEqual({
			socket: { host: 'h', port: 6379, tls: true },
			username: 'u',
			password: 'p',
			database: 3,
		});
	});

	test(oneLine`
		REDIS_KEEP_ALIVE overrides the URL form into an object carrying socket.keepAlive
		(disables the 5s probe so an idle preview can App-Sleep)
	`, () => {
		setEnv({ REDIS: 'redis://localhost:6379/2', REDIS_KEEP_ALIVE: false });

		expect(getRedisConnection()).toEqual({
			url: 'redis://localhost:6379/2',
			socket: { keepAlive: false },
		});
	});

	test('REDIS_KEEP_ALIVE threads into the host/port socket options', () => {
		setEnv({ REDIS_HOST: 'h', REDIS_PORT: '6379', REDIS_KEEP_ALIVE: 600_000 });

		expect(getRedisConnection()).toEqual({
			socket: { host: 'h', port: 6379, keepAlive: 600_000 },
		});
	});
});

describe('scoped cache purging', () => {
	beforeEach(() => {
		setEnv({
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			CACHE_AUTO_PURGE_MODE: 'scoped',
		});

		emitFilter.mockImplementation(
			async (_event: string, payload: ScopedCacheDeclaredFingerprint[]) => payload,
		);
	});

	describe('scopedCachePurgeEnabled', () => {
		test('true only when mode=scoped AND store=redis', () => {
			expect(scopedCachePurgeEnabled()).toBe(true);
		});

		test('false when mode is full', () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
			expect(scopedCachePurgeEnabled()).toBe(false);
		});

		test('false when store is memory even if mode=scoped', () => {
			env['CACHE_STORE'] = 'memory';
			expect(scopedCachePurgeEnabled()).toBe(false);
		});
	});

	describe('assertScopedCacheStoreSupported', () => {
		afterEach(() => {
			redis.isCluster = false;
		});

		test(oneLine`
			throws at startup when scoped mode runs against a Redis cluster client
			(SCAN/DEL are single-node)
		`, () => {
			redis.isCluster = true;
			expect(() => assertScopedCacheStoreSupported()).toThrow(/cluster/i);
		});

		test('no-op on a standalone client', () => {
			redis.isCluster = false;
			expect(() => assertScopedCacheStoreSupported()).not.toThrow();
		});

		test('no-op in full mode even against a cluster client', () => {
			redis.isCluster = true;
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
			expect(() => assertScopedCacheStoreSupported()).not.toThrow();
		});
	});

	describe('indexScopedCacheEntry', () => {
		test(oneLine`
			indexes the key + expires sibling in each collection's bare set, with a TTL
		`, async () => {
			await indexScopedCacheEntry('resp-key', [
				{ collection: 'articles' },
				{ collection: 'directus_users' },
			]);

			// The members ride the script, which files them and moves the set's
			// expiry OUT only. 2 × CACHE_TTL (5m = 300s) = 600s.
			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:articles:',
				600,
				'articles:&|resp-key',
				'articles:&|resp-key__expires_at',
			);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:directus_users:',
				600,
				'directus_users:&|resp-key',
				'directus_users:&|resp-key__expires_at',
			);

			expect(redis._pipeline.exec).toHaveBeenCalledOnce();
		});

		test(oneLine`
			carries every value of a pin in ONE member, which is the AND a tag per value
			could not spell
		`, async () => {
			await indexScopedCacheEntry('resp-key', [
				{
					collection: 'slots',
					pinnedScope: { student: ['7', 'A'] },
				},
			]);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:slots:',
				600,
				'slots:&student=,7,A,&|resp-key',
				'slots:&student=,7,A,&|resp-key__expires_at',
			);
		});

		test('a null scope value serializes to a sentinel, not "null"', async () => {
			await indexScopedCacheEntry('resp-key', [
				{
					collection: 'slots',
					pinnedScope: { student: ['\x00null'] },
				},
			]);

			// The sentinel keeps SQL NULL distinct from a literal "null" string value.
			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:slots:',
				600,
				'slots:&student=,\x00null,&|resp-key',
				'slots:&student=,\x00null,&|resp-key__expires_at',
			);
		});

		test(oneLine`
			files a read into the set its index value owns, and no other
		`, async () => {
			const schema = new SchemaBuilder()
				.collection('slots', (c) => {
					c.field('id').id();
					c.field('student').string();
				})
				.build();

			schema.collections['slots']!.scopedCacheFields = ['student'];

			await indexScopedCacheEntry(
				'resp-key',
				[{
					collection: 'slots',
					pinnedScope: { student: ['7'] },
				}],
				[],
				schema,
			);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledOnce();

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:slots:student=7',
				600,
				'slots:&student=,7,&|resp-key',
				'slots:&student=,7,&|resp-key__expires_at',
			);
		});

		test(oneLine`
			files a read bound to a LIST of index values under each of them: a write of
			either value has to find it
		`, async () => {
			const schema = new SchemaBuilder()
				.collection('slots', (c) => {
					c.field('id').id();
					c.field('student').string();
				})
				.build();

			schema.collections['slots']!.scopedCacheFields = ['student'];

			await indexScopedCacheEntry(
				'resp-key',
				[{
					collection: 'slots',
					pinnedScope: { student: ['A', 'B'] },
				}],
				[],
				schema,
			);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledTimes(2);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:slots:student=A',
				600,
				'slots:&student=,A,B,&|resp-key',
				'slots:&student=,A,B,&|resp-key__expires_at',
			);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:slots:student=B',
				600,
				'slots:&student=,A,B,&|resp-key',
				'slots:&student=,A,B,&|resp-key__expires_at',
			);
		});

		test('a duplicated fingerprint re-sends the same members', async () => {
			await indexScopedCacheEntry('resp-key', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			// Keyed off the array position rather than the rendered form, so the same
			// bucket is sent once per duplicate — redundant but harmless, since a
			// SADD of the same members twice leaves the set exactly as it was.
			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledTimes(2);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:slots:',
				600,
				'slots:&student=,A,&|resp-key',
				'slots:&student=,A,&|resp-key__expires_at',
			);
		});

		test('no-op when no tags', async () => {
			await indexScopedCacheEntry('resp-key', []);
			expect(redis.pipeline).not.toHaveBeenCalled();
		});

		test('no-op in full mode', async () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';

			await indexScopedCacheEntry('resp-key', [
				{ collection: 'articles' },
			]);

			expect(redis.pipeline).not.toHaveBeenCalled();
		});

		test('indexes the extra siblings alongside the key', async () => {
			await indexScopedCacheEntry('resp-key', [
				{ collection: 'articles' },
			], [
				'resp-key__pins',
			]);

			expect(redis._pipeline.scopedCacheTagExpiry).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:articles:',
				600,
				'articles:&|resp-key',
				'articles:&|resp-key__expires_at',
				'articles:&|resp-key__pins',
			);
		});
	});

	describe('purgeScopedCache', () => {
		// What each fingerprint set holds, keyed by the set a case expects the purge
		// to read. A purge names a pin, never the set holding it, so a collection's
		// sets are found by scanning its own prefix — which is why a case declares
		// them under their whole key.
		let indexedMembers: Record<string, string[]>;

		// The keys handed to the collection sweep's script, one entry per call.
		const swept: string[][] = [];

		beforeEach(() => {
			indexedMembers = {};
			swept.length = 0;

			redis.sscan.mockImplementation(async (indexKey: string) => {
				return ['0', indexedMembers[indexKey] ?? []] as [string, string[]];
			});

			redis.scan.mockImplementation(async (
				_cursor: string,
				_match: string,
				pattern: string,
			) => {
				const scanned = pattern.slice(0, -1);

				return ['0', Object.keys(indexedMembers).filter((indexKey) => {
					return indexKey.startsWith(scanned);
				})] as [string, string[]];
			});

			// The sweep is one script, so the double runs what the script runs: read
			// every set it was handed, and drop them. A case still arms which set
			// holds what, and still sees the sweep ask for exactly those.
			redis.eval.mockImplementation(async (
				_script: string,
				numKeys: number,
				...args: string[]
			) => {
				const sweptKeys = args.slice(0, numKeys);
				swept.push(sweptKeys);

				return sweptKeys.flatMap((indexKey) => indexedMembers[indexKey] ?? []);
			});
		});

		test(oneLine`
			always purges the collection-level tag (global readers) alongside slices
		`, async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:': ['slots:&|global-key'],
				'scalabus:scoped-cache-index:fingerprint:slots:student=A': [
					'slots:&student=,A,&|key-a',
					'slots:&student=,A,&|key-a__expires_at',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			expect(cache.delete).toHaveBeenCalledWith('global-key');
			expect(cache.delete).toHaveBeenCalledWith('key-a');
			expect(cache.delete).toHaveBeenCalledWith('key-a__expires_at');

			// The members go, not the sets: a set is split by an index value, not by
			// the pin this purge names, so dropping one would take every entry filed
			// under that value whatever it is bound to.
			expect(redis._pipeline.srem).toHaveBeenCalledWith(
				'scalabus:scoped-cache-index:fingerprint:slots:',
				'slots:&|global-key',
			);

			expect(cache.clear).not.toHaveBeenCalled();
		});

		test(oneLine`
			purges the tags it had when a cache.purge extension throws, rather than
			failing a mutation whose write already committed
		`, async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:student=A': [
					'slots:&student=,A,&|key-a',
				],
			};

			emitFilter.mockRejectedValueOnce(new Error('extension exploded'));

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			// The filter runs after the transaction, so letting it out answers 500 for
			// a durable write — and, sitting outside `purgeOrRecord`, records nothing
			// either, leaving the entries it was about to drop with nothing coming.
			await expect(purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			])).resolves.toEqual([
				{ collection: 'slots' },
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			expect(cache.delete).toHaveBeenCalledWith('key-a');
			expect(cache.clear).not.toHaveBeenCalled();
		});

		test('records the purge, how wide it reached and what it took', async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:': [
					'slots:&|global-key',
					'slots:&|global-key__expires_at',
				],
				'scalabus:scoped-cache-index:fingerprint:slots:student=A': [
					'slots:&student=,A,&|key-a',
					'slots:&student=,A,&|key-a__expires_at',
					'slots:&student=,A,&|key-a__pins',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			// Two pins, and TWO entries — not the five keys deleted. An entry is
			// indexed alongside its `__expires_at` sibling and any extra sibling
			// (`__pins`), so counting members would report every entry twice over and
			// draw an eviction line at double the truth.
			expect(queueCachePurge).toHaveBeenCalledWith({
				collection: 'slots',
				mode: 'slices',
				// The pins themselves, in the display form the entry sidecar stores,
				// so a purge row joins against an entry rather than merely counting.
				scopedCachePins: ['slots', 'slots:student=A'],
				scopedCachePinCount: 2,
				evicted: 2,
				// Wall-clock, so only its presence is asserted.
				durationMs: expect.any(Number),
			});

			// The sidecars are still deleted — only the count excludes them.
			expect(cache.delete).toHaveBeenCalledWith('global-key__expires_at');
			expect(cache.delete).toHaveBeenCalledWith('key-a__pins');
			expect(cache.delete).toHaveBeenCalledTimes(5);
		});

		test('counts only the entries that were still there to delete', async () => {
			// Nothing SREMs a member until a purge matches it, so a key that expired
			// by TTL is still named by its set. Counting memberships would report it
			// as evicted — and on the per-user keys this fork exists for, with a TTL
			// shorter than the gap between mutations, that is most of a set.
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:student=A': [
					'slots:&student=,A,&|live-key',
					'slots:&student=,A,&|live-key__expires_at',
					'slots:&student=,A,&|stale-key',
					'slots:&student=,A,&|stale-key__expires_at',
				],
			};

			const cache = {
				clear: vi.fn(),
				// What a Keyv store answers: false where the key was already gone.
				delete: vi.fn(async (key: string) => {
					return key.startsWith('live-key');
				}),
			} as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			// One, not two: the stale entry was named by the set and deleted for
			// nothing. Counted, it would inflate the eviction line, the Purges tile
			// and the purge ratio all at once.
			expect(queueCachePurge).toHaveBeenCalledWith(
				expect.objectContaining({ evicted: 1 }),
			);

			// It was still ASKED for — the count changes, the cleanup does not.
			expect(cache.delete).toHaveBeenCalledWith('stale-key');
		});

		test(oneLine`
			drops a slice's entries in one UNLINK against redis, and reports what it
			replied rather than one delete per key
		`, async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:student=A': [
					'slots:&student=,A,&|key-a',
					'slots:&student=,A,&|key-a__expires_at',
					'slots:&student=,A,&|key-b',
					'slots:&student=,A,&|key-b__expires_at',
				],
			};

			const unlink = vi.fn().mockResolvedValue(1);

			const cache = {
				clear: vi.fn(),
				delete: vi.fn(),
				namespace: 'scalabus_response',
				store: {
					namespace: 'scalabus_response',
					getClient: async () => ({ unlink }),
					createKeyPrefix: (key: string, namespace?: string) => {
						return `${namespace}::${key}`;
					},
				},
			} as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			// A purge over a slice used to send one delete per key, so its cost grew
			// with how much the cache held rather than with what the mutation
			// touched. Two calls now: the entries, and their sidecars.
			expect(cache.delete).not.toHaveBeenCalled();
			expect(unlink).toHaveBeenCalledTimes(2);

			expect(unlink).toHaveBeenCalledWith([
				'scalabus_response::scalabus_response:key-a',
				'scalabus_response::scalabus_response:key-b',
			]);

			expect(unlink).toHaveBeenCalledWith([
				'scalabus_response::scalabus_response:key-a__expires_at',
				'scalabus_response::scalabus_response:key-b__expires_at',
			]);

			// One, though two entries were named: a key that expired by TTL is still
			// a member until the purge matches it, and UNLINK is the one thing that
			// knows which of them was still there.
			expect(queueCachePurge).toHaveBeenCalledWith(
				expect.objectContaining({ evicted: 1 }),
			);
		});

		test('records the coarse fallback as the wider thing it is', async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:articles:': [
					'articles:&|global-key',
					'articles:&|global-key__expires_at',
				],
				'scalabus:scoped-cache-index:fingerprint:articles:author=1': [
					'articles:&author=,1,&|slice-key',
				],
				'scalabus:scoped-cache-index:fingerprint:articles:author=2': [
					'articles:&author=,2,&|slice-key',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'articles', null);

			// Three index sets: the bare one plus every split the scan found. Two
			// entries, because both splits named the same key — deduped across the
			// sets rather than counted per set.
			expect(queueCachePurge).toHaveBeenCalledWith({
				collection: 'articles',
				mode: 'collection',
				// Derived rather than chosen: every set the scan found, unbounded.
				// `collection` plus the mode already state the reach exactly.
				scopedCachePins: null,
				scopedCachePinCount: 3,
				evicted: 2,
				// Wall-clock, so only its presence is asserted.
				durationMs: expect.any(Number),
			});
		});

		test(oneLine`
			one coarse purge is one record, not one per index set it swept
		`, async () => {
			// The fallback scans every set of the collection. It is still a single
			// purge operation, so a bucket count of purges stays a count of purges
			// rather than tracking how wide each one happened to reach.
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:articles:': [],
				'scalabus:scoped-cache-index:fingerprint:articles:author=1': [],
				'scalabus:scoped-cache-index:fingerprint:articles:author=2': [],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'articles', null);

			expect(queueCachePurge).toHaveBeenCalledOnce();

			expect(queueCachePurge).toHaveBeenCalledWith({
				collection: 'articles',
				mode: 'collection',
				scopedCachePins: null,
				scopedCachePinCount: 3,
				evicted: 0,
				// Wall-clock, so only its presence is asserted.
				durationMs: expect.any(Number),
			});
		});

		test('records a non-scoped flush without inventing a size', async () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'articles', [
				{ collection: 'articles', pinnedScope: { author: ['1'] } },
			]);

			expect(cache.clear).toHaveBeenCalledOnce();

			// The clear takes the whole namespace, so there is no member list to
			// count. The size is unknown, not zero — zero would plot the most
			// destructive event in the system as one that took nothing.
			expect(queueCachePurge).toHaveBeenCalledWith({
				collection: null,
				mode: 'namespace',
				scopedCachePins: null,
				scopedCachePinCount: 0,
				evicted: null,
				// Wall-clock, so only its presence is asserted.
				durationMs: expect.any(Number),
			});
		});

		test(oneLine`
			spares the entries bound to another value — student=B is left cached when
			purging student=A, though both sit in the same collection
		`, async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:student=A': [
					'slots:&student=,A,&|key-a',
				],
				'scalabus:scoped-cache-index:fingerprint:slots:student=B': [
					'slots:&student=,B,&|key-b',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			expect(cache.delete).toHaveBeenCalledWith('key-a');
			expect(cache.delete).not.toHaveBeenCalledWith('key-b');
		});

		test('no scoped cache tags purges only the collection-level tag', async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:articles:': [
					'articles:&|key-a',
					'articles:&|key-a__expires_at',
					'articles:&|key-b',
				],
				'scalabus:scoped-cache-index:fingerprint:articles:author=1': [
					'articles:&author=,1,&|sliced-key',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'articles');

			expect(cache.delete).toHaveBeenCalledTimes(3);

			// The bare pin reaches the reads that pinned nothing, and stops there: an
			// entry bound to a value is not made stale by a purge naming no value.
			expect(cache.delete).not.toHaveBeenCalledWith('sliced-key');
			expect(cache.clear).not.toHaveBeenCalled();
		});

		test(oneLine`
			null scopedCachePins falls back to a collection-wide purge (every set the
			collection owns), sparing other collections
		`, async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:articles:': [
					'articles:&|global-key',
				],
				'scalabus:scoped-cache-index:fingerprint:articles:author=1': [
					'articles:&author=,1,&|slice-key',
				],
				'scalabus:scoped-cache-index:fingerprint:articles_archive:': [
					'articles_archive:&|archive-key',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'articles', null);

			// The glob ends on the separator, which is what keeps a prefix sibling
			// (`articles_archive`) out of a purge of `articles`.
			expect(redis.scan).toHaveBeenCalledWith(
				'0',
				'MATCH',
				'scalabus:scoped-cache-index:fingerprint:articles:*',
				'COUNT',
				expect.any(Number),
			);

			expect(cache.delete).toHaveBeenCalledWith('global-key');
			expect(cache.delete).toHaveBeenCalledWith('slice-key');
			expect(cache.delete).not.toHaveBeenCalledWith('archive-key');

			// ONE command for every set the purge sweeps, and it is a script: a
			// pipeline only orders its own commands, so another client could file a
			// key into a set between the read and the drop and have that set deleted
			// under it.
			expect(redis.eval).toHaveBeenCalledOnce();

			expect(swept).toEqual([[
				'scalabus:scoped-cache-index:fingerprint:articles:',
				'scalabus:scoped-cache-index:fingerprint:articles:author=1',
			]]);

			expect(cache.clear).not.toHaveBeenCalled();
		});

		test(oneLine`
			the collection-wide purge takes every set the scan names, and drops them
			whole rather than member by member
		`, async () => {
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:articles:': [
					'articles:&|global-key',
				],
				'scalabus:scoped-cache-index:fingerprint:articles:author=1': [
					'articles:&author=,1,&|first-key',
				],
				'scalabus:scoped-cache-index:fingerprint:articles:author=2': [
					'articles:&author=,2,&|second-key',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'articles', null);

			expect(swept).toEqual([[
				'scalabus:scoped-cache-index:fingerprint:articles:',
				'scalabus:scoped-cache-index:fingerprint:articles:author=1',
				'scalabus:scoped-cache-index:fingerprint:articles:author=2',
			]]);

			expect(cache.delete).toHaveBeenCalledWith('global-key');
			expect(cache.delete).toHaveBeenCalledWith('first-key');
			expect(cache.delete).toHaveBeenCalledWith('second-key');

			// The sets go inside the script, so nothing prunes them afterwards: a
			// member re-added while the sweep ran cannot be SREMed after the fact,
			// and a set left naming keys it just dropped would grow without bound.
			expect(redis._pipeline.srem).not.toHaveBeenCalled();
		});

		test('full mode flushes the whole cache and never touches redis', async () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'articles', [
				{ collection: 'articles', pinnedScope: { student: ['A'] } },
			]);

			expect(cache.clear).toHaveBeenCalledTimes(1);
			expect(cache.delete).not.toHaveBeenCalled();
			expect(redis.sscan).not.toHaveBeenCalled();
			expect(redis.scan).not.toHaveBeenCalled();
		});

		test(oneLine`
			a numeric mutation value resolves the same slice a string-pinned read tagged
		`, async () => {
			// Read side pinned `student=7` off a REST string; the mutation resolves the
			// value as numeric 7 from the row. The purge must hit the string-pinned
			// entry, not a separate `student=7` (number).
			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:student=7': [
					'slots:&student=,7,&|read-key',
				],
				'scalabus:scoped-cache-index:fingerprint:slots:student=A': [
					'slots:&student=,A,&|other-key',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', [
				scopedCacheFingerprintOf('slots', [{ field: 'student', value: 7 }]),
			]);

			expect(cache.delete).toHaveBeenCalledWith('read-key');
			expect(cache.delete).not.toHaveBeenCalledWith('other-key');
		});

		test(oneLine`
			a cache.purge filter that empties the tag set deletes nothing and never
			reads an index set
		`, async () => {
			// A delete with no keys throws; an extension is free to drop every pin, so
			// the empty set must be a no-op rather than a crash (and must not degrade
			// into a full flush).
			emitFilter.mockImplementation(async () => []);

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			expect(redis.sscan).not.toHaveBeenCalled();
			expect(redis.scan).not.toHaveBeenCalled();
			expect(cache.delete).not.toHaveBeenCalled();
			expect(cache.clear).not.toHaveBeenCalled();
		});

		test(oneLine`
			cache.purge filter augments the purge set (extension-resolved tags get dropped)
		`, async () => {
			emitFilter.mockImplementation(async (
				_event: string,
				fingerprints: ScopedCacheDeclaredFingerprint[],
			) => {
				return [...fingerprints, {
					collection: 'slots',
					pinnedScope: { owner: ['B'] },
				}];
			});

			indexedMembers = {
				'scalabus:scoped-cache-index:fingerprint:slots:owner=B': [
					'slots:&owner=,B,&|owned-key',
				],
				'scalabus:scoped-cache-index:fingerprint:slots:owner=C': [
					'slots:&owner=,C,&|unowned-key',
				],
			};

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeScopedCache(cache, 'slots', []);

			expect(emitFilter).toHaveBeenCalledWith(
				'cache.purge',
				[{ collection: 'slots' }],
				{ collection: 'slots' },
				null,
			);

			expect(cache.delete).toHaveBeenCalledWith('owned-key');
			expect(cache.delete).not.toHaveBeenCalledWith('unowned-key');
		});

		test('returns null when scoped purge is off', async () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			expect(await purgeScopedCache(cache, 'slots', [])).toBeNull();
			expect(cache.clear).toHaveBeenCalledOnce();
		});

		test(oneLine`
			returns the bare collection fingerprint for a coarse purge
		`, async () => {
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			expect(await purgeScopedCache(cache, 'articles', null)).toEqual([
				{ collection: 'articles' },
			]);
		});

		test('returns the resolved slice fingerprints it purged', async () => {
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			const purged = await purgeScopedCache(cache, 'slots', [
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);

			expect(purged).toEqual([
				{ collection: 'slots' },
				{ collection: 'slots', pinnedScope: { student: ['A'] } },
			]);
		});
	});
});

describe('getCache', () => {
	test(oneLine`
		builds the four layers under the namespaced _response / _system / _schema /
		_lock suffixes on a memory store
	`, () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
		});

		const caches = getCache();

		expect(caches.cache?.namespace).toBe('scalabus_response');
		expect(caches.systemCache.namespace).toBe('scalabus_system');
		expect(caches.localSchemaCache.namespace).toBe('scalabus_schema');
		expect(caches.lockCache.namespace).toBe('scalabus_lock');
	});

	test(oneLine`
		every tier stores its entries in the fork's envelope, not @keyv/serialize's
	`, async () => {
		const {
			deserializeCacheEnvelope,
			serializeCacheEnvelope,
		} = await import('./cache-envelope.js');

		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
		});

		const caches = getCache();

		for (const tier of [
			caches.cache!,
			caches.systemCache,
			caches.localSchemaCache,
			caches.lockCache,
		]) {
			expect(tier.serialize).toBe(serializeCacheEnvelope);
			expect(tier.deserialize).toBe(deserializeCacheEnvelope);
		}

		// The memory store serializes too, so what it holds is the envelope itself.
		await caches.cache!.set('k', Buffer.from('bytes'));

		const held = (caches.cache!.store as Map<string, string>)
			.get('scalabus_response:k');

		expect(held).toMatch(/^\{"envelope":2,"base64":"/);
		expect((await caches.cache!.get('k') as Buffer).toString()).toBe('bytes');
	});

	test('narrows CACHE_STORE=redis through the store ternary', () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
		});

		// instances are memoized from the memory build above; this call re-runs
		// the store narrowing down its redis branch
		expect(getCache().systemCache).toBeTruthy();
	});

	// The caches are module-level and built once, so the store the module settles on
	// is decided by whichever test ran first — every case above this one gets the
	// memory build back and none of them reaches `getConfig`'s redis half. Reloading
	// the module is the only way to ask it to build a redis store, and the options it
	// hands `@keyv/redis` are the whole point of that half: without
	// `disableOfflineQueue` a command issued during an outage waits in a queue with no
	// deadline, and the request that made it waits with it.
	async function reloadCacheWith(env: Record<string, unknown>) {
		setEnv(env);
		vi.resetModules();

		const reloaded = await import('./cache.js');

		return reloaded.getCache();
	}

	test('refuses queued commands on the store built from REDIS_HOST', async () => {
		const { systemCache } = await reloadCacheWith({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
		});

		const store = systemCache.store as { client: { options: Record<string, any> } };

		expect(store.client.options['disableOfflineQueue']).toBe(true);

		expect(store.client.options['socket'])
			.toEqual({ host: 'localhost', port: 6108 });
	});

	test(oneLine`
		the adapter listens to its own client and forwards what it hears, so a cache
		never leaves a connection unlistened — the opposite was asserted in comments on
		this branch for a while, and only a test keeps it honest
	`, async () => {
		const { systemCache } = await reloadCacheWith({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
		});

		const store = systemCache.store as {
			client: {
				listenerCount(event: string): number;
				emit(event: string, payload: unknown): boolean;
			};
		};

		// Registered by `KeyvRedis.initClient()` from its own constructor, before
		// anything here attaches — so the client is never an EventEmitter without an
		// `error` listener, and an unreachable Redis cannot rethrow through it.
		expect(store.client.listenerCount('error')).toBeGreaterThan(0);

		// And what it hears it passes on, which is why a handler on the Keyv instance
		// sees connection failures rather than only what Keyv itself raises.
		const seen: unknown[] = [];

		systemCache.on('error', (error) => seen.push(error));

		const dropped = new Error('Socket closed unexpectedly');

		store.client.emit('error', dropped);

		expect(seen).toContain(dropped);
	});

	test(oneLine`
		dials the store's client as it is built, so the first two commands a fresh
		worker sends at once do not find it open and not yet ready
	`, async () => {
		const { systemCache } = await reloadCacheWith({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
		});

		const store = systemCache.store as {
			client: { isOpen: boolean; destroy(): void };
		};

		// Open is what `getClient()` returns early on — the dial has started, and
		// nothing here waits for the socket to answer.
		expect(store.client.isOpen).toBe(true);

		// Nothing listens on that port here; stop the reconnects it would keep trying.
		store.client.destroy();
	});

	test(oneLine`
		and on the one built from a REDIS url, which reaches the adapter as options
		rather than as a string, so both spellings back off the same way
	`, async () => {
		const { systemCache } = await reloadCacheWith({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			REDIS: 'redis://localhost:6379/2',
		});

		const store = systemCache.store as { client: { options: Record<string, any> } };

		expect(store.client.options['disableOfflineQueue']).toBe(true);
		expect(store.client.options['url']).toBe('redis://localhost:6379/2');
	});
});

describe('flushCaches', () => {
	test(oneLine`
		clears the response + system caches but leaves the lock cache untouched — the
		build-identity fingerprint stored there must survive the flush it triggers
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_SYSTEM_TTL: '5m',
			CACHE_STORE: 'memory',
		});

		const { cache, systemCache, lockCache } = getCache();

		await cache!.set('response-key', 'r');
		await systemCache.set('system-key', 's');
		await lockCache.set('build-identity', 'fingerprint');

		await flushCaches(true);

		expect(await cache!.get('response-key')).toBeUndefined();
		expect(await systemCache.get('system-key')).toBeUndefined();
		// Else cache-build-identity would re-flush on every boot.
		expect(await lockCache.get('build-identity')).toBe('fingerprint');
	});

	test(oneLine`
		drops the scoped-tag index too — those SETs live in raw redis outside the Keyv
		namespace, so the response clear misses them and they would linger as pointers
		to keys that no longer exist
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		redis.scan.mockResolvedValueOnce(
			['0', ['scalabus:scoped-cache-index:fingerprint:articles:id=1']],
		);

		await flushCaches(true);

		// Not `scalabus:*`: `MATCH` filters server-side, so a pattern wider than the
		// index shipped every cache-stats tombstone and fill-guard epoch key over the
		// wire to be filtered out in the client. Measured on the dev keyspace, that
		// was 84 keys crossing to unlink 0.
		expect(redis.scan).toHaveBeenCalledWith(
			'0',
			'MATCH',
			'scalabus:scoped-cache-index:*',
			'COUNT',
			1000,
		);

		expect(redis._pipeline.unlink)
			.toHaveBeenCalledWith([
				'scalabus:scoped-cache-index:fingerprint:articles:id=1',
			]);
	});

	test(oneLine`
		says what the flush cost — on the boot path this is time the container is not
		serving, and the only line it used to write was that it had started
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		redis.scan.mockResolvedValueOnce(['0', [
			'scalabus:scoped-cache-index:fingerprint:articles',
			'scalabus:scoped-cache-index:fingerprint:articles:id=1',
		]]);

		await flushCaches(true);

		expect(logger.info).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\[cache\] flushed in \d+ms, dropped 2 scoped-cache index keys$/,
			),
		);
	});

	test(oneLine`
		survives a permission cache that cannot clear — it is a multi cache over
		ioredis, so it rejects where the Keyv tiers swallow, and the schema apply that
		called this has already committed: failing it reports a change that landed as
		one that did not, while leaving exactly the same entries stale
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		clearPermissionCache.mockRejectedValueOnce(
			new Error('Reached the max retries per request limit (which is 20).'),
		);

		// Reported rather than thrown, and reported rather than swallowed: an
		// operator-invoked flush that exits 0 having cleared nothing tells a deploy
		// the caches are warm on the new data when every one of them is stale.
		await expect(flushCaches(true)).resolves.toMatchObject({
			failures: ['system cache'],
		});
	});

	test(oneLine`
		survives a bus that cannot publish — the schemaChanged fan-out rides Redis, so
		it is down in exactly the outage this has to live through, and a lost message
		is no less lost for failing the caller that already cleared its own tiers
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		busPublish
		.mockRejectedValueOnce(new Error('Connection is closed.'))
		.mockRejectedValueOnce(new Error('Connection is closed.'));

		// Both publishes ride the same bus and both fail, but only one is a flush
		// failure: the `schemaChanged` fan-out is caught where it is sent, since the
		// mutations that trigger it have already committed. The outage still shows
		// up, under the `cacheCleared` publish this call makes itself.
		await expect(flushCaches(true)).resolves.toMatchObject({
			failures: ['peer notification'],
		});

		expect(busPublish).toHaveBeenCalledTimes(2);
	});

	// A peer on a memory store holds its own response and system tiers, and
	// `schemaChanged` reaches neither: its handler drops the response cache only
	// under CACHE_AUTO_PURGE, and never touches `_system` at all. Those nodes kept
	// serving the reads this call exists to retire.
	test(oneLine`
		tells the other nodes which tiers went, so a peer on a memory store drops the
		copies only it holds
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		await flushCaches(true);

		expect(busPublish).toHaveBeenCalledWith('cacheCleared', {
			targets: ['response', 'system'],
		});
	});

	test(oneLine`
		survives an unreachable redis — the migration runner calls this after recording
		the version it just applied and does not catch, so a throw here fails a deploy
		over a cache the request path treats as a MISS anyway
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		redis.scan.mockRejectedValue(new Error('Connection is closed.'));

		const report = await flushCaches(true);

		expect(report.failures).toEqual(['scoped-cache index']);
		expect(report.droppedIndexKeys).toBe(0);
	});

	test(oneLine`
		reports a response cache it could not clear rather than throwing it at the
		migration runner, which calls this uncaught right after recording the version
		it applied
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
		});

		const { cache } = getCache();

		// Restored by hand: `clearAllMocks` empties a spy without uninstalling it,
		// leaving every later clear of this same instance a silent no-op.
		const refuse = vi.spyOn(cache!, 'clear')
			.mockRejectedValueOnce(new Error('Connection is closed.'));

		onTestFinished(() => refuse.mockRestore());

		await expect(flushCaches(true)).resolves.toMatchObject({
			failures: ['response cache'],
		});
	});

	test(oneLine`
		reports an index whose unlink redis refused — a pipeline answers per command,
		so a chunk that failed is a chunk still there, and a count alone cannot tell
		that from an index that was already empty
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		redis.scan.mockResolvedValueOnce(
			['0', ['scalabus:scoped-cache-index:fingerprint:articles']],
		);

		redis._pipeline.exec.mockResolvedValueOnce([
			[new Error('MISCONF Redis is configured to save RDB snapshots'), null],
		]);

		const report = await flushCaches(true);

		expect(report.failures).toEqual(['scoped-cache index']);
		expect(report.droppedIndexKeys).toBe(0);
	});

	test(oneLine`
		walks the index keyspace once, not once per kind — the layout this replaced
		took a pass for the tags and another for the slices, and a SCAN pass costs the
		whole keyspace whatever it matches
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		await flushCaches(true);

		expect(redis.scan).toHaveBeenCalledTimes(1);

		expect(redis.scan).toHaveBeenCalledWith(
			'0',
			'MATCH',
			'scalabus:scoped-cache-index:*',
			'COUNT',
			1000,
		);
	});

	test(oneLine`
		unlinks each scan batch as it arrives rather than buffering the whole index
		keyspace — the array is the one thing here that grows with the cache
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		redis.scan
		.mockResolvedValueOnce([
			'42',
			['scalabus:scoped-cache-index:fingerprint:articles'],
		])
		.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:authors'],
		]);

		await flushCaches(true);

		expect(redis._pipeline.unlink).toHaveBeenCalledTimes(2);
	});

	test(oneLine`
		says the cost as an outcome rather than as a second opinion — a line reading
		"flushed" under the warn saying it was not answers the same question twice
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_STORE: 'memory',
		});

		clearPermissionCache.mockRejectedValueOnce(
			new Error('Reached the max retries per request limit (which is 20).'),
		);

		await flushCaches(true);

		expect(logger.info).not.toHaveBeenCalled();

		const [line] = logger.warn.mock.calls.at(-1)!;

		expect(line).toMatch(/^\[cache\] flushed in \d+ms, dropped 0 scoped/);
		expect(line).toMatch(/index keys, without system cache$/);
	});
});

describe('a bus that cannot publish', () => {
	beforeEach(() => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
		});

		busPublish.mockRejectedValue(new Error('Connection is closed.'));
	});

	// 23 call sites reach this from a mutation whose write already committed, and
	// `collections.ts` calls it from a `finally`, where a throw replaces the
	// outcome it was running after — including the error it was already carrying.
	test('does not fail the schema change that asked for the fan-out', async () => {
		await expect(clearSystemCache()).resolves.toBeUndefined();
		expect(logger.warn).toHaveBeenCalled();
	});

	test('does not fail the flush an operator asked for', async () => {
		await expect(clearCacheTargets(['response'])).resolves.toBeUndefined();
		expect(logger.warn).toHaveBeenCalled();
	});
});

describe('the cacheCleared broadcast', () => {
	function watchClears() {
		const { cache, systemCache } = getCache();

		// Asserted on the call rather than on what the tier holds: these Keyv
		// instances are module singletons the whole file shares, so a value written
		// here is at the mercy of whatever built them first.
		const response = vi.spyOn(cache!, 'clear').mockResolvedValue(undefined);
		const system = vi.spyOn(systemCache, 'clear').mockResolvedValue(undefined);

		onTestFinished(() => {
			response.mockRestore();
			system.mockRestore();
		});

		return { response, system };
	}

	test(oneLine`
		is the only thing that drops a memory-store peer's response tier once
		CACHE_AUTO_PURGE is off — with it on, the schemaChanged handler already did,
		which is why a peer arm left it on proves nothing
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
			CACHE_AUTO_PURGE: false,
		});

		const { response } = watchClears();

		await cacheHandlers['schemaChanged']!({ autoPurgeCache: undefined });
		expect(response).not.toHaveBeenCalled();

		await cacheHandlers['cacheCleared']!({ targets: ['response', 'system'] });
		expect(response).toHaveBeenCalled();
	});

	test(oneLine`
		is not what drops that peer's response tier when CACHE_AUTO_PURGE is on: the
		schemaChanged handler this flush already published gets there first, so a peer
		arm that leaves it on passes with the broadcast removed
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
			CACHE_AUTO_PURGE: true,
		});

		const { response } = watchClears();

		await cacheHandlers['schemaChanged']!({ autoPurgeCache: undefined });

		expect(response).toHaveBeenCalled();
	});

	test(oneLine`
		is the only thing that drops that peer's system tier, whatever
		CACHE_AUTO_PURGE says — schemaChanged never touches the _system tier, so this
		is the half of the broadcast a response-tier arm cannot stand in for
	`, async () => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_SYSTEM_TTL: '5m',
			CACHE_STORE: 'memory',
			CACHE_AUTO_PURGE: true,
		});

		const { system } = watchClears();

		await cacheHandlers['schemaChanged']!({ autoPurgeCache: undefined });
		expect(system).not.toHaveBeenCalled();

		await cacheHandlers['cacheCleared']!({ targets: ['response', 'system'] });
		expect(system).toHaveBeenCalled();
	});
});

describe('clearCacheTargets', () => {
	beforeEach(() => {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
		});
	});

	function refuseTheIndexUnlink() {
		redis.scan.mockResolvedValueOnce(
			['0', ['scalabus:scoped-cache-index:fingerprint:articles']],
		);

		redis._pipeline.exec.mockResolvedValueOnce([
			[new Error('MISCONF Redis is configured to save RDB snapshots'), null],
		]);
	}

	// Unlike the flush this wraps, this one has somebody waiting on the answer: an
	// admin who asked for the clear and is told 200 either way reads a half-dropped
	// index as a finished job, and what survived it stays invisible.
	test('fails a clear whose index unlink redis refused', async () => {
		refuseTheIndexUnlink();

		await expect(clearCacheTargets(['response'])).rejects.toThrowError(
			/scoped-cache index/,
		);
	});

	test(oneLine`
		tells the other nodes before it says so — the tiers it did clear are cleared
		whatever it then reports, and a peer left holding them is the worse outcome
	`, async () => {
		refuseTheIndexUnlink();

		await expect(clearCacheTargets(['response'])).rejects.toThrowError();

		expect(busPublish).toHaveBeenCalledWith('cacheCleared', {
			targets: ['response'],
		});
	});
});

// A flush, like every purge, has to move the counters BEFORE it drops anything: a
// read that snapshotted earlier and rechecks between the clear and a bump made after
// it compares equal, keeps the entry it just wrote, and the index drop that follows
// unlinks the pin sets it was filed under — stale for its TTL, reachable to no
// later purge. The clear is the first drop, so the bump goes in front of it.
describe('the wholesale counter moves before the response clear', () => {
	function recordFlushOrder() {
		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			CACHE_AUTO_PURGE_MODE: 'scoped',
		});

		const calls: string[] = [];
		const { cache } = getCache();

		const clear = vi.spyOn(cache!, 'clear').mockImplementation(async () => {
			calls.push('clear');
		});

		onTestFinished(() => clear.mockRestore());

		redis._pipeline.incr.mockImplementation((key: string) => {
			calls.push(`incr ${key}`);
		});

		redis.scan.mockImplementation(async () => {
			calls.push('scan');
			return ['0', []] as [string, string[]];
		});

		return calls;
	}

	test('in flushCaches', async () => {
		const calls = recordFlushOrder();

		await flushCaches(true);

		expect(calls).toEqual(['incr scalabus:scoped-cache-epoch:*', 'clear', 'scan']);
	});

	test('in clearCacheTargets', async () => {
		const calls = recordFlushOrder();

		await clearCacheTargets(['response']);

		expect(calls).toEqual(['incr scalabus:scoped-cache-epoch:*', 'clear', 'scan']);
	});
});

describe('what the flush duration counts', () => {
	// `startedAt` sat after `getCache()`, whose first call builds the four Keyv
	// tiers — on the boot path exactly the work the caller waits through, and the
	// one run where the number was worth reading.
	test('the cache build the first call has to do', async () => {
		let clock = 0;
		const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);

		vi.resetModules();

		vi.doMock('keyv', () => {
			return {
				default: class {
					store = {};
					constructor() {
						clock += 5;
					}

					on() {}
					async get() {}
					async set() {}
					async delete() {}
					async clear() {}
				},
			};
		});

		onTestFinished(async () => {
			now.mockRestore();
			vi.doUnmock('keyv');
			vi.resetModules();
			await import('./cache.js');
		});

		setEnv({
			CACHE_ENABLED: true,
			CACHE_NAMESPACE: 'scalabus',
			CACHE_TTL: '5m',
			CACHE_STORE: 'memory',
		});

		const reloaded = await import('./cache.js');

		// Only the first call builds anything, so this is the run that has to count
		// it — a second one would measure a flush over caches already standing.
		const report = await reloaded.flushCaches(true);

		expect(report.durationMs).toBeGreaterThan(0);
	});
});
