import type { ScopedCacheTag } from '@directus/types';
import type Keyv from 'keyv';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// cache.ts captures `const env = useEnv()` at module load, so mutate one shared object
// (never reassign) to keep that reference and getConfigFromEnv's useEnv() in sync.
const mockEnv = vi.hoisted(() => ({ current: {} as Record<string, any> }));
const env = mockEnv.current;

const redis = vi.hoisted(() => {
	const pipeline = { sadd: vi.fn(), expire: vi.fn(), exec: vi.fn() };
	// chainable pipeline
	pipeline.sadd.mockReturnValue(pipeline);
	pipeline.expire.mockReturnValue(pipeline);

	return {
		smembers: vi.fn(),
		del: vi.fn(),
		pipeline: vi.fn(() => pipeline),
		_pipeline: pipeline,
	};
});

// Passthrough filter by default; individual tests override to assert extension augmentation.
const emitFilter = vi.hoisted(() => vi.fn(async (_event: string, payload: unknown) => payload));

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv.current }));
vi.mock('./bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }) }));
vi.mock('./logger/index.js', () => ({ useLogger: () => ({ warn() {}, error() {}, info() {} }) }));
vi.mock('./emitter.js', () => ({ default: { emitFilter } }));

vi.mock('./redis/index.js', () => ({
	redisConfigAvailable: () => true,
	useRedis: () => redis,
}));

const { getRedisConnection, purgeCache, scopedCachePurgeEnabled, tagScopedCacheKeys } = await import('./cache.js');

function setEnv(values: Record<string, unknown>) {
	for (const key of Object.keys(mockEnv.current)) delete mockEnv.current[key];
	Object.assign(mockEnv.current, values);
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('getRedisConnection', () => {
	beforeEach(() => setEnv({}));

	test('passes a REDIS connection URL through unchanged (@keyv/redis v5 accepts URLs)', () => {
		setEnv({ REDIS: 'redis://localhost:6379/2' });
		expect(getRedisConnection()).toBe('redis://localhost:6379/2');
	});

	test('translates ioredis-shaped REDIS_HOST/REDIS_PORT to node-redis socket options', () => {
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
});

describe('scoped cache purging', () => {
	beforeEach(() => {
		setEnv({
			CACHE_NAMESPACE: 'system-cache',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			CACHE_AUTO_PURGE_MODE: 'scoped',
		});

		emitFilter.mockImplementation(async (_event: string, payload: unknown) => payload);
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

	describe('tagScopedCacheKeys', () => {
		test('indexes the key + expires sibling under every collection-level tag, with a TTL', async () => {
			await tagScopedCacheKeys('resp-key', [{ collection: 'articles' }, { collection: 'directus_users' }]);

			expect(redis._pipeline.sadd).toHaveBeenCalledWith('system-cache:tag:articles', 'resp-key', 'resp-key__expires_at');

			expect(redis._pipeline.sadd).toHaveBeenCalledWith(
				'system-cache:tag:directus_users',
				'resp-key',
				'resp-key__expires_at',
			);

			// 2 × CACHE_TTL (5m = 300s) = 600s
			expect(redis._pipeline.expire).toHaveBeenCalledWith('system-cache:tag:articles', 600);
			expect(redis._pipeline.exec).toHaveBeenCalledOnce();
		});

		test('scoped cache tags encode field=value into the tag key', async () => {
			await tagScopedCacheKeys('resp-key', [
				{ collection: 'slots', field: 'student', value: 'A' },
				{ collection: 'slots', field: 'student', value: 7 },
			]);

			expect(redis._pipeline.sadd).toHaveBeenCalledWith(
				'system-cache:tag:slots:student=A',
				'resp-key',
				'resp-key__expires_at',
			);

			expect(redis._pipeline.sadd).toHaveBeenCalledWith(
				'system-cache:tag:slots:student=7',
				'resp-key',
				'resp-key__expires_at',
			);
		});

		test('a null scope value serializes to a stable sentinel', async () => {
			await tagScopedCacheKeys('resp-key', [{ collection: 'slots', field: 'student', value: null }]);

			expect(redis._pipeline.sadd).toHaveBeenCalledWith(
				'system-cache:tag:slots:student=null',
				'resp-key',
				'resp-key__expires_at',
			);
		});

		test('duplicate tags collapse to a single SADD', async () => {
			await tagScopedCacheKeys('resp-key', [
				{ collection: 'slots', field: 'student', value: 'A' },
				{ collection: 'slots', field: 'student', value: 'A' },
			]);

			expect(redis._pipeline.sadd).toHaveBeenCalledOnce();
		});

		test('no-op when no tags', async () => {
			await tagScopedCacheKeys('resp-key', []);
			expect(redis.pipeline).not.toHaveBeenCalled();
		});

		test('no-op in full mode', async () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
			await tagScopedCacheKeys('resp-key', [{ collection: 'articles' }]);
			expect(redis.pipeline).not.toHaveBeenCalled();
		});
	});

	describe('purgeCache', () => {
		test('always purges the collection-level tag (global readers) alongside slices', async () => {
			redis.smembers.mockImplementation(async (tagKey: string) =>
				tagKey === 'system-cache:tag:slots' ? ['global-key'] : ['key-a', 'key-a__expires_at'],
			);

			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'slots', [{ collection: 'slots', field: 'student', value: 'A' }]);

			expect(redis.smembers).toHaveBeenCalledWith('system-cache:tag:slots');
			expect(redis.smembers).toHaveBeenCalledWith('system-cache:tag:slots:student=A');
			expect(cache.delete).toHaveBeenCalledWith('global-key');
			expect(cache.delete).toHaveBeenCalledWith('key-a');
			expect(cache.delete).toHaveBeenCalledWith('key-a__expires_at');
			expect(redis.del).toHaveBeenCalledWith('system-cache:tag:slots', 'system-cache:tag:slots:student=A');
			expect(cache.clear).not.toHaveBeenCalled();
		});

		test('spares other slices — student=B is never touched when purging student=A', async () => {
			redis.smembers.mockResolvedValue([]);
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'slots', [{ collection: 'slots', field: 'student', value: 'A' }]);

			expect(redis.smembers).not.toHaveBeenCalledWith('system-cache:tag:slots:student=B');
			expect(redis.del).not.toHaveBeenCalledWith(expect.stringContaining('student=B'));
		});

		test('no scoped cache tags purges only the collection-level tag', async () => {
			redis.smembers.mockResolvedValue(['key-a', 'key-a__expires_at', 'key-b']);
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'articles');

			expect(redis.smembers).toHaveBeenCalledWith('system-cache:tag:articles');
			expect(redis.smembers).toHaveBeenCalledOnce();
			expect(cache.delete).toHaveBeenCalledTimes(3);
			expect(redis.del).toHaveBeenCalledWith('system-cache:tag:articles');
			expect(cache.clear).not.toHaveBeenCalled();
		});

		test('null scopedCacheTags falls back to a full flush (unresolvable mutation)', async () => {
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'articles', null);

			expect(cache.clear).toHaveBeenCalledTimes(1);
			expect(cache.delete).not.toHaveBeenCalled();
			expect(redis.smembers).not.toHaveBeenCalled();
		});

		test('full mode flushes the whole cache and never touches redis', async () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'articles', [{ collection: 'articles', field: 'student', value: 'A' }]);

			expect(cache.clear).toHaveBeenCalledTimes(1);
			expect(cache.delete).not.toHaveBeenCalled();
			expect(redis.smembers).not.toHaveBeenCalled();
		});

		test('cache.purge filter augments the purge set (extension-resolved tags get dropped)', async () => {
			emitFilter.mockImplementation(async (_event: string, tags: ScopedCacheTag[]) => [
				...tags,
				{ collection: 'slots', field: 'owner', value: 'B' },
			]);

			redis.smembers.mockResolvedValue(['owned-key']);
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'slots', []);

			expect(emitFilter).toHaveBeenCalledWith('cache.purge', [{ collection: 'slots' }], { collection: 'slots' }, null);
			expect(redis.smembers).toHaveBeenCalledWith('system-cache:tag:slots:owner=B');
			expect(redis.del).toHaveBeenCalledWith('system-cache:tag:slots', 'system-cache:tag:slots:owner=B');
		});
	});
});
