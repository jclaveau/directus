import type { Redis } from 'ioredis';
import type Keyv from 'keyv';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
	cacheRegistryEnabled,
	evictCacheEntriesForPath,
	evictCacheEntry,
	listCacheEntries,
	recordCacheHit,
	registerCacheEntry,
} from './cache-registry.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';

const env: Record<string, any> = {
	CACHE_STATS_ENABLED: true,
	CACHE_STORE: 'redis',
	CACHE_NAMESPACE: 'scalabus',
	CACHE_TTL: '5m',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('./redis/index.js');

let mockRedis: {
	hset: Mock;
	expire: Mock;
	eval: Mock;
	del: Mock;
	scan: Mock;
	pipeline: Mock;
};

let pipeline: {
	hgetall: Mock;
	exec: Mock;
};

beforeEach(() => {
	pipeline = {
		hgetall: vi.fn().mockReturnThis(),
		exec: vi.fn(),
	};

	mockRedis = {
		hset: vi.fn(),
		expire: vi.fn(),
		eval: vi.fn(),
		del: vi.fn(),
		scan: vi.fn(),
		pipeline: vi.fn().mockReturnValue(pipeline),
	};

	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue(mockRedis as unknown as Redis);
});

afterEach(() => {
	vi.clearAllMocks();
	env['CACHE_STATS_ENABLED'] = true;
	env['CACHE_STORE'] = 'redis';
});

describe('cacheRegistryEnabled', () => {
	it('is true for redis store with stats on and redis configured', () => {
		expect(cacheRegistryEnabled()).toBe(true);
	});

	it('is false when CACHE_STATS_ENABLED is false', () => {
		env['CACHE_STATS_ENABLED'] = false;
		expect(cacheRegistryEnabled()).toBe(false);
	});

	it('is false for a memory store', () => {
		env['CACHE_STORE'] = 'memory';
		expect(cacheRegistryEnabled()).toBe(false);
	});

	it('is false when redis is not configured', () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(cacheRegistryEnabled()).toBe(false);
	});
});

describe('registerCacheEntry', () => {
	it('writes the descriptor hash and expires it with the value TTL', async () => {
		await registerCacheEntry({
			key: 'k1',
			path: '/items/articles',
			method: 'GET',
			user: 'user-1',
			createdAt: 1000,
			expiresAt: 301000,
			size: 42,
		});

		expect(mockRedis.hset).toHaveBeenCalledWith('scalabus:entry:k1', {
			path: '/items/articles',
			method: 'GET',
			user: 'user-1',
			createdAt: '1000',
			expiresAt: '301000',
			size: '42',
		});

		// 5m TTL → 300s.
		expect(mockRedis.expire).toHaveBeenCalledWith('scalabus:entry:k1', 300);
	});

	it('stores a null user and null expiry as empty strings', async () => {
		await registerCacheEntry({
			key: 'k2',
			path: '/server/info',
			method: 'GET',
			user: null,
			createdAt: 1000,
			expiresAt: null,
			size: 0,
		});

		expect(mockRedis.hset).toHaveBeenCalledWith(
			'scalabus:entry:k2',
			expect.objectContaining({ user: '', expiresAt: '' }),
		);
	});

	it('does nothing when the registry is disabled', async () => {
		env['CACHE_STATS_ENABLED'] = false;

		await registerCacheEntry({
			key: 'k3',
			path: '/x',
			method: 'GET',
			user: null,
			createdAt: 1,
			expiresAt: null,
			size: 0,
		});

		expect(mockRedis.hset).not.toHaveBeenCalled();
	});
});

describe('recordCacheHit', () => {
	it('runs the guarded increment against the entry hash', async () => {
		await recordCacheHit('k1');

		expect(mockRedis.eval).toHaveBeenCalledWith(
			expect.stringContaining('HINCRBY'),
			1,
			'scalabus:entry:k1',
		);
	});

	it('does nothing when the registry is disabled', async () => {
		env['CACHE_STORE'] = 'memory';

		await recordCacheHit('k1');

		expect(mockRedis.eval).not.toHaveBeenCalled();
	});
});

describe('listCacheEntries', () => {
	it('scans every hash, parses it, and returns newest first', async () => {
		mockRedis.scan
			.mockResolvedValueOnce(['5', ['scalabus:entry:old']])
			.mockResolvedValueOnce(['0', ['scalabus:entry:new', 'scalabus:entry:junk']]);

		pipeline.exec.mockResolvedValue([
			[null, {
				path: '/items/a',
				method: 'GET',
				user: 'u1',
				createdAt: '100',
				expiresAt: '400',
				size: '10',
				hits: '3',
			}],
			[null, {
				path: '/items/a',
				method: 'GET',
				user: '',
				createdAt: '200',
				expiresAt: '',
				size: '20',
				hits: '7',
			}],
			// A hash that expired mid-scan → empty HGETALL, dropped.
			[null, {}],
		]);

		const entries = await listCacheEntries();

		expect(mockRedis.scan).toHaveBeenCalledTimes(2);
		expect(entries).toHaveLength(2);

		// Newest createdAt first.
		expect(entries[0]).toMatchObject({
			key: 'new',
			createdAt: 200,
			user: null,
			expiresAt: null,
			hits: 7,
		});

		expect(entries[1]).toMatchObject({
			key: 'old',
			createdAt: 100,
			user: 'u1',
			expiresAt: 400,
			hits: 3,
		});
	});

	it('returns an empty array with no scan when disabled', async () => {
		env['CACHE_STATS_ENABLED'] = false;

		expect(await listCacheEntries()).toEqual([]);
		expect(mockRedis.scan).not.toHaveBeenCalled();
	});
});

describe('evictCacheEntry', () => {
	it('deletes the value, its siblings, and the registry hash', async () => {
		const cache = { delete: vi.fn() } as unknown as Keyv;

		await evictCacheEntry(cache, 'k1');

		expect(cache.delete).toHaveBeenCalledWith('k1');
		expect(cache.delete).toHaveBeenCalledWith('k1__expires_at');
		expect(cache.delete).toHaveBeenCalledWith('k1__tags');
		expect(mockRedis.del).toHaveBeenCalledWith('scalabus:entry:k1');
	});
});

describe('evictCacheEntriesForPath', () => {
	it('evicts only entries on the path and returns the count', async () => {
		const cache = { delete: vi.fn() } as unknown as Keyv;

		mockRedis.scan.mockResolvedValue([
			'0',
			['scalabus:entry:a', 'scalabus:entry:b', 'scalabus:entry:c'],
		]);

		pipeline.exec.mockResolvedValue([
			[null, { path: '/items/a', createdAt: '1', size: '0', hits: '0' }],
			[null, { path: '/items/b', createdAt: '2', size: '0', hits: '0' }],
			[null, { path: '/items/a', createdAt: '3', size: '0', hits: '0' }],
		]);

		const count = await evictCacheEntriesForPath(cache, '/items/a');

		expect(count).toBe(2);
		expect(mockRedis.del).toHaveBeenCalledWith('scalabus:entry:a');
		expect(mockRedis.del).toHaveBeenCalledWith('scalabus:entry:c');
		expect(mockRedis.del).not.toHaveBeenCalledWith('scalabus:entry:b');
	});
});
