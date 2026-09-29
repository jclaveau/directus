import { useEnv } from '@directus/env';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useLogger } from '../../logger/index.js';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { createRedis } from './create-redis.js';
import {
	_cache,
	cacheRedisDatabase,
	flushCacheRedisDatabase,
	useCacheRedis,
} from './use-cache-redis.js';
import { useRedis } from './use-redis.js';

vi.mock('@directus/env');
vi.mock('../../logger/index.js');
vi.mock('../../utils/get-config-from-env.js');
vi.mock('./create-redis.js');
vi.mock('./use-redis.js');

const warn = vi.fn();

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ warn } as any);
	vi.mocked(getConfigFromEnv).mockReturnValue({});
});

afterEach(() => {
	_cache.redis = undefined;
	_cache.database = undefined;
	vi.clearAllMocks();
});

describe('cacheRedisDatabase', () => {
	test('is undefined when CACHE_REDIS_DB is unset', () => {
		vi.mocked(useEnv).mockReturnValue({ REDIS: 'redis://h:6379' });

		expect(cacheRedisDatabase()).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();
	});

	test(oneLine`
		takes a database apart from the one a REDIS URL without a path selects
	`, () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_REDIS_DB: 1,
		});

		expect(cacheRedisDatabase()).toBe(1);
	});

	test('takes a database apart from the one the REDIS URL path selects', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379/2',
			CACHE_REDIS_DB: 0,
		});

		expect(cacheRedisDatabase()).toBe(0);
	});

	test('ignores the database the REDIS URL path already selects, and warns', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379/2',
			CACHE_REDIS_DB: 2,
		});

		expect(cacheRedisDatabase()).toBeUndefined();

		expect(warn).toHaveBeenCalledWith(
			'[cache] CACHE_REDIS_DB=2 is not apart from the database REDIS selects, '
			+ 'so the cache stays in it and is flushed key by key',
		);
	});

	test('ignores database 0 when REDIS names no database', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_REDIS_DB: 0,
		});

		expect(cacheRedisDatabase()).toBeUndefined();
	});

	test('ignores the database REDIS_DB selects in the host/port form', () => {
		vi.mocked(useEnv).mockReturnValue({ REDIS_HOST: 'h', CACHE_REDIS_DB: 3 });
		vi.mocked(getConfigFromEnv).mockReturnValue({ host: 'h', db: '3' });

		expect(cacheRedisDatabase()).toBeUndefined();
	});

	test('takes a database apart from REDIS_DB in the host/port form', () => {
		vi.mocked(useEnv).mockReturnValue({ REDIS_HOST: 'h', CACHE_REDIS_DB: 1 });
		vi.mocked(getConfigFromEnv).mockReturnValue({ host: 'h' });

		expect(cacheRedisDatabase()).toBe(1);
	});

	test('reads the database a db query parameter selects, as ioredis does', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379?db=3',
			CACHE_REDIS_DB: 3,
		});

		expect(cacheRedisDatabase()).toBeUndefined();
	});

	test(oneLine`
		refuses database 0 beside a db query parameter, which node-redis ignores
	`, () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379?db=3',
			CACHE_REDIS_DB: 0,
		});

		expect(cacheRedisDatabase()).toBeUndefined();
	});

	test('takes a database apart from both readings of a db query parameter', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379?db=3',
			CACHE_REDIS_DB: 1,
		});

		expect(cacheRedisDatabase()).toBe(1);
	});

	test('reads the path before a db query parameter, as ioredis does', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379/2?db=3',
			CACHE_REDIS_DB: 3,
		});

		expect(cacheRedisDatabase()).toBe(3);
	});

	test('ignores it when the REDIS path is not a database number', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379/abc',
			CACHE_REDIS_DB: 1,
		});

		expect(cacheRedisDatabase()).toBeUndefined();
	});

	test('ignores it when REDIS is a host and port with no scheme', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'h:6379',
			CACHE_REDIS_DB: 0,
		});

		expect(cacheRedisDatabase()).toBeUndefined();
	});

	test('ignores it when REDIS_DB is not a database number', () => {
		vi.mocked(useEnv).mockReturnValue({ REDIS_HOST: 'h', CACHE_REDIS_DB: 1 });
		vi.mocked(getConfigFromEnv).mockReturnValue({ host: 'h', db: 'x' });

		expect(cacheRedisDatabase()).toBeUndefined();
	});

	test('ignores it when REDIS is an address whose database cannot be read', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: '/var/run/redis.sock',
			CACHE_REDIS_DB: 1,
		});

		expect(cacheRedisDatabase()).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
	});

	test('ignores a value that is not a database number, and warns', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_REDIS_DB: -1,
		});

		expect(cacheRedisDatabase()).toBeUndefined();

		expect(warn).toHaveBeenCalledWith(
			'[cache] CACHE_REDIS_DB=-1 is not a database number, ignored',
		);
	});

	test('reads the env once', () => {
		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_REDIS_DB: 'x',
		});

		cacheRedisDatabase();
		cacheRedisDatabase();

		expect(warn).toHaveBeenCalledOnce();
	});
});

describe('useCacheRedis', () => {
	test('is the shared client when the cache has no database of its own', () => {
		const sharedRedis = { name: 'shared' };
		vi.mocked(useRedis).mockReturnValue(sharedRedis as any);
		vi.mocked(useEnv).mockReturnValue({ REDIS: 'redis://h:6379' });

		expect(useCacheRedis()).toBe(sharedRedis);
		expect(createRedis).not.toHaveBeenCalled();
	});

	test('opens one client on the cache database, and keeps it', () => {
		const cacheRedis = { name: 'cache' };
		vi.mocked(createRedis).mockReturnValue(cacheRedis as any);

		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_REDIS_DB: 1,
		});

		expect(useCacheRedis()).toBe(cacheRedis);
		expect(useCacheRedis()).toBe(cacheRedis);
		expect(createRedis).toHaveBeenCalledOnce();
		expect(createRedis).toHaveBeenCalledWith(1);
	});
});

describe('flushCacheRedisDatabase', () => {
	test(oneLine`
		empties the cache database with FLUSHDB ASYNC, and queues the caller's
		commands in the same MULTI
	`, async () => {
		const flushTransaction = {
			flushdb: vi.fn(() => flushTransaction),
			set: vi.fn(),
			exec: vi.fn(async () => [[null, 'OK'], [null, 'OK']]),
		};

		vi.mocked(createRedis).mockReturnValue({ multi: () => flushTransaction } as any);

		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_STORE: 'redis',
			CACHE_REDIS_DB: 1,
		});

		const flushed = await flushCacheRedisDatabase((flushTransaction) => {
			flushTransaction.set('kept', '1');
		});

		expect(flushed).toBe('flushed');
		expect(flushTransaction.flushdb).toHaveBeenCalledWith('ASYNC');
		expect(flushTransaction.set).toHaveBeenCalledWith('kept', '1');
		expect(warn).not.toHaveBeenCalled();
	});

	test(oneLine`
		leaves the shared database alone when the cache has none of its own
	`, async () => {
		const multi = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ multi } as any);

		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_STORE: 'redis',
		});

		expect(await flushCacheRedisDatabase()).toBe('not-flushed');
		expect(multi).not.toHaveBeenCalled();
	});

	test('flushes nothing under the memory store', async () => {
		const multi = vi.fn();
		vi.mocked(createRedis).mockReturnValue({ multi } as any);

		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_STORE: 'memory',
			CACHE_REDIS_DB: 1,
		});

		expect(await flushCacheRedisDatabase()).toBe('not-flushed');
		expect(multi).not.toHaveBeenCalled();
	});

	test(oneLine`
		answers false on a Redis that refuses FLUSHDB, so the caller clears key by
		key
	`, async () => {
		const refusal = new Error(
			'EXECABORT Transaction discarded because of previous errors.',
		);

		const flushTransaction = {
			flushdb: vi.fn(() => flushTransaction),
			exec: vi.fn().mockRejectedValue(refusal),
		};

		vi.mocked(createRedis).mockReturnValue({ multi: () => flushTransaction } as any);

		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_STORE: 'redis',
			CACHE_REDIS_DB: 1,
		});

		expect(await flushCacheRedisDatabase()).toBe('not-flushed');

		expect(warn).toHaveBeenCalledWith(
			refusal,
			'[cache] FLUSHDB refused, clearing the cache key by key: '
			+ 'Error: EXECABORT Transaction discarded because of previous errors.',
		);
	});

	test(oneLine`
		answers flushed-queued-command-failed and warns when the FLUSHDB ran and a
		command queued after it failed
	`, async () => {
		const refusal = new Error('OOM command not allowed');

		const flushTransaction = {
			flushdb: vi.fn(() => flushTransaction),
			exec: vi.fn(async () => [[null, 'OK'], [refusal, null]]),
		};

		vi.mocked(createRedis).mockReturnValue({ multi: () => flushTransaction } as any);

		vi.mocked(useEnv).mockReturnValue({
			REDIS: 'redis://h:6379',
			CACHE_STORE: 'redis',
			CACHE_REDIS_DB: 1,
		});

		expect(await flushCacheRedisDatabase())
			.toBe('flushed-queued-command-failed');

		expect(warn).toHaveBeenCalledWith(
			refusal,
			'[cache] FLUSHDB ran, a command queued after it failed: '
			+ 'Error: OOM command not allowed',
		);
	});
});
