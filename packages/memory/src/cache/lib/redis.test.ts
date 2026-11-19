import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KvRedis, createKv } from '../../kv/index.js';
import { CacheRedis } from './redis.js';

vi.mock('ioredis');
vi.mock('../../kv/index.js');
vi.mock('../../utils/index.js');

const mockKey = 'test-key';
const mockValue = 'test-value';
const mockNamespace = 'test-namespace';

let mockRedis: Redis;
let cache: CacheRedis;

beforeEach(() => {
	vi.mocked(createKv).mockReturnValue(new KvRedis({ namespace: mockNamespace, redis: mockRedis }));

	mockRedis = new Redis();
	cache = new CacheRedis({ namespace: mockNamespace, redis: mockRedis });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Instantiates Kv with configuration', () => {
		expect(createKv).toHaveBeenCalledWith({
			type: 'redis',
			redis: mockRedis,
			namespace: mockNamespace,
		});

		expect(cache['store']).toBeInstanceOf(KvRedis);
	});
});

describe('get', () => {
	test('Returns result of store get', async () => {
		vi.mocked(cache['store'].get).mockResolvedValue(mockValue);

		const res = await cache.get(mockKey);

		expect(res).toBe(mockValue);
	});
});

describe('set', () => {
	test('Sets the value to the kv store', async () => {
		await cache.set(mockKey, mockValue);

		expect(cache['store'].set).toHaveBeenCalledWith(mockKey, mockValue);
	});
});

describe('delete', () => {
	test('Deletes key from kv store', async () => {
		await cache.delete(mockKey);

		expect(cache['store'].delete).toHaveBeenCalledWith(mockKey);
	});
});

describe('has', () => {
	test('Returns result of kv store has', async () => {
		vi.mocked(cache['store'].has).mockResolvedValue(true);

		const res = await cache.has(mockKey);

		expect(res).toBe(true);
	});
});

describe('clear', () => {
	test('Moves the generation before removing the keys', async () => {
		await cache.clear();

		expect(cache['store'].bumpGeneration).toHaveBeenCalledOnce();
		expect(cache['store'].clear).toHaveBeenCalledOnce();

		// A write checked before the move lands before the removal, which drops it;
		// a write checked after it is refused.
		expect(
			vi.mocked(cache['store'].bumpGeneration).mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(cache['store'].clear).mock.invocationCallOrder[0]!);
	});
});

describe('readGeneration', () => {
	test('Returns the generation of the kv store', async () => {
		vi.mocked(cache['store'].readGeneration).mockResolvedValue(7);

		await expect(cache.readGeneration()).resolves.toBe(7);
	});
});

describe('setUnlessCleared', () => {
	test('Returns whether the kv store kept the value', async () => {
		vi.mocked(cache['store'].setUnlessCleared).mockResolvedValue(false);

		await expect(
			cache.setUnlessCleared(mockKey, mockValue, 7),
		).resolves.toBe(false);

		expect(cache['store'].setUnlessCleared)
			.toHaveBeenCalledWith(mockKey, mockValue, 7);
	});
});
