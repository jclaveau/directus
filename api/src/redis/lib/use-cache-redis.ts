import { useEnv } from '@directus/env';
import { type ChainableCommander, Redis } from 'ioredis';
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

function databaseNumber(raw: unknown): number | undefined {
	const database = Number(raw);

	return Number.isInteger(database) && database >= 0
		? database
		: undefined;
}

/**
 * The database `REDIS` itself selects, read the way ioredis reads it: the URL's
 * path, else its `db` query parameter, else 0. `undefined` for an address this
 * cannot read — a unix socket path, a `host:port` with no scheme.
 */
function sharedRedisDatabase(): number | undefined {
	const url = useEnv()['REDIS'];

	if (!url) {
		const { db } = getConfigFromEnv('REDIS');

		return databaseNumber(db ?? 0);
	}

	let redisAddress: URL;

	try {
		redisAddress = new URL(url as string);
	}
	catch {
		return undefined;
	}

	if (
		redisAddress.protocol !== 'redis:'
		&& redisAddress.protocol !== 'rediss:'
	) {
		return undefined;
	}

	return databaseNumber(
		redisAddress.pathname.slice(1)
		|| redisAddress.searchParams.get('db')
		|| 0,
	);
}

function readCacheRedisDatabase(): number | undefined {
	const raw = useEnv()['CACHE_REDIS_DB'];

	if (raw === undefined || raw === null || raw === '') {
		return undefined;
	}

	const database = databaseNumber(raw);
	const logger = useLogger();

	if (database === undefined) {
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

export type CacheDatabaseFlush =
	| 'not-flushed'
	| 'flushed'
	| 'flushed-queued-command-failed';

/**
 * Empty the cache's own database in one command, answering whether it did.
 *
 * `not-flushed` sends the caller to its key-by-key clear: no database of its own,
 * a memory store, or a Redis that refused — a managed one may rename FLUSHDB away.
 * `ASYNC` so the memory is reclaimed off Redis's main thread: the keys are gone
 * for every client the moment the command returns.
 *
 * `queueAfterFlush` adds commands to the FLUSHDB's own MULTI, so no other client
 * runs between the two. A refused FLUSHDB discards them with it; one of them
 * refused after the FLUSHDB ran answers `flushed-queued-command-failed`.
 */
export async function flushCacheRedisDatabase(
	queueAfterFlush?: (flushTransaction: ChainableCommander) => void,
): Promise<CacheDatabaseFlush> {
	if (useEnv()['CACHE_STORE'] !== 'redis' || cacheRedisDatabase() === undefined) {
		return 'not-flushed';
	}

	const flushTransaction = useCacheRedis()
		.multi()
		.flushdb('ASYNC');

	queueAfterFlush?.(flushTransaction);

	let transactionReplies: [Error | null, unknown][] | null;

	try {
		transactionReplies = await flushTransaction.exec();
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[cache] FLUSHDB refused, clearing the cache key by key: ${error}`,
		);

		return 'not-flushed';
	}

	let databaseFlush: CacheDatabaseFlush = 'flushed';

	for (const [error] of transactionReplies?.slice(1) ?? []) {
		if (error) {
			databaseFlush = 'flushed-queued-command-failed';

			useLogger().warn(
				error,
				`[cache] FLUSHDB ran, a command queued after it failed: ${error}`,
			);
		}
	}

	return databaseFlush;
}
