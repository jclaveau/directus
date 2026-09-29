import { useEnv } from '@directus/env';
import { Redis } from 'ioredis';
import { useLogger } from '../../logger/index.js';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { createRedis } from './create-redis.js';
import { useRedis } from './use-redis.js';

/**
 * Memoization cache for useCacheRedis and cacheRedisDatabase
 *
 * @see {@link useCacheRedis}
 */
export const _cache: {
	redis: Redis | undefined;
	database: { value: number | undefined } | undefined;
} = {
	redis: undefined,
	database: undefined,
};

/**
 * The database `REDIS` itself selects, or `undefined` when its address is not a
 * URL this can read — a unix socket path, say.
 */
function sharedRedisDatabase(): number | undefined {
	const url = useEnv()['REDIS'];

	if (url) {
		try {
			const path = new URL(url as string).pathname.slice(1);

			return path === ''
				? 0
				: Number(path);
		}
		catch {
			return undefined;
		}
	}

	const { db } = getConfigFromEnv('REDIS');

	return db === undefined
		? 0
		: Number(db);
}

function readCacheRedisDatabase(): number | undefined {
	const raw = useEnv()['CACHE_REDIS_DB'];

	if (raw === undefined || raw === null || raw === '') {
		return undefined;
	}

	const database = Number(raw);
	const logger = useLogger();

	if (!Number.isInteger(database) || database < 0) {
		logger.warn(`[cache] CACHE_REDIS_DB=${raw} is not a database number, ignored`);
		return undefined;
	}

	const shared = sharedRedisDatabase();

	// A FLUSHDB there would take the locks, the synchronization clocks and the
	// stats buffer with it.
	if (shared === undefined || shared === database) {
		logger.warn(
			`[cache] CACHE_REDIS_DB=${database} is not apart from the database `
			+ 'REDIS selects, so the cache stays in it and is flushed key by key',
		);

		return undefined;
	}

	return database;
}

/**
 * The Redis database the response cache and the scoped-cache index live in when
 * they have one of their own, `undefined` when they share `REDIS`'s.
 */
export function cacheRedisDatabase(): number | undefined {
	_cache.database ??= { value: readCacheRedisDatabase() };

	return _cache.database.value;
}

/**
 * The client of the cache's own database, or the shared client when there is
 * none.
 */
export const useCacheRedis = (): Redis => {
	const database = cacheRedisDatabase();

	if (database === undefined) {
		return useRedis();
	}

	_cache.redis ??= createRedis(database);

	return _cache.redis;
};

/**
 * Empty the cache's own database in one command, answering whether it did.
 *
 * `false` sends the caller to its key-by-key clear: no database of its own, a
 * memory store, or a Redis that refused — a managed one may rename FLUSHDB away.
 * `ASYNC` so the memory is reclaimed off Redis's main thread: the keys are gone
 * for every client the moment the command returns.
 */
export async function flushCacheRedisDatabase(): Promise<boolean> {
	if (useEnv()['CACHE_STORE'] !== 'redis' || cacheRedisDatabase() === undefined) {
		return false;
	}

	try {
		await useCacheRedis().flushdb('ASYNC');
		return true;
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[cache] FLUSHDB refused, clearing the cache key by key: ${error}`,
		);

		return false;
	}
}
