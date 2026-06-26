import type Keyv from 'keyv';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// cache.ts captures `const env = useEnv()` at module load, so mutate one shared object
// (never reassign) to keep that reference and getConfigFromEnv's useEnv() in sync.
const mockEnv = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

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

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv.current }));
vi.mock('./logger/index.js', () => ({ useLogger: () => ({ warn() {}, error() {}, info() {} }) }));
vi.mock('./bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }) }));
vi.mock('./redis/index.js', () => ({ redisConfigAvailable: () => true, useRedis: () => redis }));

const { getRedisConnection, purgeCache, scopedCachePurgeEnabled, tagCacheKeyCollections } = await import('./cache.js');

function setEnv(values: Record<string, unknown>) {
	for (const key of Object.keys(mockEnv.current)) delete mockEnv.current[key];
	Object.assign(mockEnv.current, values);
}

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
		vi.clearAllMocks();

		setEnv({
			CACHE_NAMESPACE: 'system-cache',
			CACHE_TTL: '5m',
			CACHE_STORE: 'redis',
			CACHE_AUTO_PURGE_MODE: 'scoped',
		});
	});

	describe('scopedCachePurgeEnabled', () => {
		test('true only when mode=scoped AND store=redis', () => {
			expect(scopedCachePurgeEnabled()).toBe(true);
		});

		test('false when mode is full', () => {
			mockEnv.current['CACHE_AUTO_PURGE_MODE'] = 'full';
			expect(scopedCachePurgeEnabled()).toBe(false);
		});

		test('false when store is memory even if mode=scoped', () => {
			mockEnv.current['CACHE_STORE'] = 'memory';
			expect(scopedCachePurgeEnabled()).toBe(false);
		});
	});

	describe('purgeCache', () => {
		test('scoped mode deletes only tagged members + the tag set, never clears', async () => {
			redis.smembers.mockResolvedValue(['key-a', 'key-a__expires_at', 'key-b']);
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'articles');

			expect(redis.smembers).toHaveBeenCalledWith('system-cache:tag:articles');
			expect(cache.delete).toHaveBeenCalledWith('key-a');
			expect(cache.delete).toHaveBeenCalledWith('key-a__expires_at');
			expect(cache.delete).toHaveBeenCalledWith('key-b');
			expect(cache.delete).toHaveBeenCalledTimes(3);
			expect(redis.del).toHaveBeenCalledWith('system-cache:tag:articles');
			expect(cache.clear).not.toHaveBeenCalled();
		});

		test('scoped mode with empty tag set deletes nothing but still drops the set', async () => {
			redis.smembers.mockResolvedValue([]);
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'articles');

			expect(cache.delete).not.toHaveBeenCalled();
			expect(redis.del).toHaveBeenCalledWith('system-cache:tag:articles');
			expect(cache.clear).not.toHaveBeenCalled();
		});

		test('full mode flushes the whole cache and never touches redis', async () => {
			mockEnv.current['CACHE_AUTO_PURGE_MODE'] = 'full';
			const cache = { clear: vi.fn(), delete: vi.fn() } as unknown as Keyv;

			await purgeCache(cache, 'articles');

			expect(cache.clear).toHaveBeenCalledTimes(1);
			expect(cache.delete).not.toHaveBeenCalled();
			expect(redis.smembers).not.toHaveBeenCalled();
		});
	});

	describe('tagCacheKeyCollections', () => {
		test('indexes the key + expires sibling under every collection, with a TTL', async () => {
			await tagCacheKeyCollections('resp-key', ['articles', 'directus_users']);

			expect(redis._pipeline.sadd).toHaveBeenCalledWith(
				'system-cache:tag:articles',
				'resp-key',
				'resp-key__expires_at',
			);

			expect(redis._pipeline.sadd).toHaveBeenCalledWith(
				'system-cache:tag:directus_users',
				'resp-key',
				'resp-key__expires_at',
			);

			// 2 × CACHE_TTL (5m = 300s) = 600s
			expect(redis._pipeline.expire).toHaveBeenCalledWith('system-cache:tag:articles', 600);
			expect(redis._pipeline.exec).toHaveBeenCalledOnce();
		});

		test('no-op when no collections', async () => {
			await tagCacheKeyCollections('resp-key', []);
			expect(redis.pipeline).not.toHaveBeenCalled();
		});

		test('no-op in full mode', async () => {
			mockEnv.current['CACHE_AUTO_PURGE_MODE'] = 'full';
			await tagCacheKeyCollections('resp-key', ['articles']);
			expect(redis.pipeline).not.toHaveBeenCalled();
		});
	});
});
