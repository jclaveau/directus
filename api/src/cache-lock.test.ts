import { oneLine } from '@directus/utils';
import { Keyv } from 'keyv';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	cacheLockHoldScript,
	cacheLockReleaseScript,
	holdCacheLock,
	readCacheLockHolder,
	releaseCacheLock,
} from './cache-lock.js';
import { useRedis } from './redis/index.js';

vi.mock('./redis/index.js', () => ({ useRedis: vi.fn() }));

afterEach(() => {
	vi.resetAllMocks();
});

// What `@keyv/redis` looks like to `cacheEntryRawKeyOf`: a store naming its keys
// with both namespaces.
function redisLockCache() {
	return {
		namespace: 'scalabus_lock',
		store: {
			namespace: 'scalabus_lock',
			getClient: async () => ({}),
			createKeyPrefix: (key: string, namespace?: string) => {
				return `${namespace}::${key}`;
			},
		},
	} as unknown as Keyv;
}

function scriptedRedis() {
	const redis = {
		defineCommand: vi.fn(),
		cacheLockHold: vi.fn(),
		cacheLockRelease: vi.fn(),
		get: vi.fn(),
	};

	vi.mocked(useRedis).mockReturnValue(redis as any);

	return redis;
}

describe('holdCacheLock on Redis', () => {
	test(oneLine`
		claims the lock under its raw key, as the token, for the TTL — and answers
		it holds it
	`, async () => {
		const redis = scriptedRedis();
		redis.cacheLockHold.mockResolvedValueOnce(1);

		expect(await holdCacheLock(
			redisLockCache(),
			'cache-audit:run',
			'run-1',
			120_000,
		)).toBe(true);

		expect(redis.cacheLockHold).toHaveBeenCalledExactlyOnceWith(
			'scalabus_lock::scalabus_lock:cache-audit:run',
			'run-1',
			120_000,
		);
	});

	test('answers it does not hold a lock another token holds', async () => {
		const redis = scriptedRedis();
		redis.cacheLockHold.mockResolvedValueOnce(0);

		expect(await holdCacheLock(
			redisLockCache(),
			'cache-audit:run',
			'run-1',
			120_000,
		)).toBe(false);
	});

	test('registers both scripts once per client', async () => {
		const redis = scriptedRedis();
		redis.cacheLockHold.mockResolvedValue(1);

		await holdCacheLock(redisLockCache(), 'cache-audit:run', 'run-1', 120_000);
		await holdCacheLock(redisLockCache(), 'cache-audit:run', 'run-1', 120_000);

		expect(redis.defineCommand.mock.calls).toEqual([
			['cacheLockHold', { numberOfKeys: 1, lua: cacheLockHoldScript }],
			['cacheLockRelease', { numberOfKeys: 1, lua: cacheLockReleaseScript }],
		]);
	});

	test(oneLine`
		claims with SET NX, and renews only while the lock still names the token
	`, () => {
		expect(cacheLockHoldScript).toBe(`
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
	return 1
end

if redis.call('GET', KEYS[1]) ~= ARGV[1] then
	return 0
end

redis.call('PEXPIRE', KEYS[1], ARGV[2])

return 1
`);
	});
});

describe('releaseCacheLock on Redis', () => {
	test('releases the lock under its raw key, as the token', async () => {
		const redis = scriptedRedis();
		redis.cacheLockRelease.mockResolvedValueOnce(1);

		await releaseCacheLock(redisLockCache(), 'cache-audit:run', 'run-1');

		expect(redis.cacheLockRelease).toHaveBeenCalledExactlyOnceWith(
			'scalabus_lock::scalabus_lock:cache-audit:run',
			'run-1',
		);
	});

	test('deletes only while the lock still names the token', () => {
		expect(cacheLockReleaseScript).toBe(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
	return 0
end

return redis.call('DEL', KEYS[1])
`);
	});
});

describe('readCacheLockHolder on Redis', () => {
	test('reads the raw key, which holds the token as it is', async () => {
		const redis = scriptedRedis();
		redis.get.mockResolvedValueOnce('run-1');

		expect(await readCacheLockHolder(redisLockCache(), 'cache-audit:run'))
			.toBe('run-1');

		expect(redis.get).toHaveBeenCalledExactlyOnceWith(
			'scalabus_lock::scalabus_lock:cache-audit:run',
		);
	});
});

describe('a memory lock cache', () => {
	test('claims a free lock as the token', async () => {
		const lockCache = new Keyv();

		expect(await holdCacheLock(lockCache, 'cache-audit:run', 'run-1', 120_000))
			.toBe(true);

		expect(await readCacheLockHolder(lockCache, 'cache-audit:run'))
			.toBe('run-1');
	});

	test('refuses a lock another token holds, and leaves it', async () => {
		const lockCache = new Keyv();
		await lockCache.set('cache-audit:run', 'run-2');

		expect(await holdCacheLock(lockCache, 'cache-audit:run', 'run-1', 120_000))
			.toBe(false);

		await releaseCacheLock(lockCache, 'cache-audit:run', 'run-1');

		expect(await readCacheLockHolder(lockCache, 'cache-audit:run'))
			.toBe('run-2');
	});

	test('renews and releases the lock the token holds', async () => {
		const lockCache = new Keyv();
		await lockCache.set('cache-audit:run', 'run-1');

		expect(await holdCacheLock(lockCache, 'cache-audit:run', 'run-1', 120_000))
			.toBe(true);

		await releaseCacheLock(lockCache, 'cache-audit:run', 'run-1');

		expect(await readCacheLockHolder(lockCache, 'cache-audit:run')).toBeNull();
	});

	test('never asks Redis', async () => {
		const redis = scriptedRedis();
		const lockCache = new Keyv();

		await holdCacheLock(lockCache, 'cache-audit:run', 'run-1', 120_000);
		await releaseCacheLock(lockCache, 'cache-audit:run', 'run-1');

		expect(useRedis).not.toHaveBeenCalled();
		expect(redis.defineCommand).not.toHaveBeenCalled();
	});
});
