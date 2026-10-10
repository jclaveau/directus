import { getConfigFromEnv } from "../../utils/get-config-from-env.js";
import { useLogger } from "../../logger/index.js";
import { createRedis } from "./create-redis.js";
import { useRedis } from "./use-redis.js";
import { useEnv } from "@directus/env";

//#region src/redis/lib/use-cache-redis.ts
/**
* Memoization cache for useCacheRedis and cacheRedisDatabase
*
* @see {@link useCacheRedis}
*/
const _cache = {
	redis: void 0,
	database: void 0
};
function databaseNumber(raw) {
	const database = Number(raw);
	return Number.isInteger(database) && database >= 0 ? database : void 0;
}
/**
* The databases `REDIS` itself selects. ioredis reads the URL's path, else its
* `db` query parameter, else 0; node-redis, under the system, schema and lock
* tiers, reads the path, else 0. `undefined` for an address this cannot read — a
* unix socket path, a `host:port` with no scheme.
*/
function sharedRedisDatabases() {
	const url = useEnv()["REDIS"];
	if (!url) {
		const { db } = getConfigFromEnv("REDIS");
		const database = databaseNumber(db ?? 0);
		return database === void 0 ? void 0 : [database];
	}
	let redisAddress;
	try {
		redisAddress = new URL(url);
	} catch {
		return;
	}
	if (redisAddress.protocol !== "redis:" && redisAddress.protocol !== "rediss:") return;
	const pathDatabase = databaseNumber(redisAddress.pathname.slice(1) || 0);
	const queryDatabase = redisAddress.searchParams.get("db");
	if (pathDatabase === void 0) return;
	if (redisAddress.pathname.length > 1 || queryDatabase === null) return [pathDatabase];
	const ioredisDatabase = databaseNumber(queryDatabase);
	return ioredisDatabase === void 0 ? void 0 : [ioredisDatabase, pathDatabase];
}
function readCacheRedisDatabase() {
	const raw = useEnv()["CACHE_REDIS_DB"];
	if (raw === void 0 || raw === null || raw === "") return;
	const database = databaseNumber(raw);
	const logger = useLogger();
	if (database === void 0) {
		logger.warn(`[cache] CACHE_REDIS_DB=${raw} is not a database number, ignored`);
		return;
	}
	const shared = sharedRedisDatabases();
	if (shared === void 0 || shared.includes(database)) {
		logger.warn(`[cache] CACHE_REDIS_DB=${database} is not apart from the database REDIS selects, so the cache stays in it and is flushed key by key`);
		return;
	}
	return database;
}
/**
* The Redis database the response cache and the scoped-cache index live in when
* they have one of their own, `undefined` when they share `REDIS`'s.
*/
function cacheRedisDatabase() {
	_cache.database ??= { value: readCacheRedisDatabase() };
	return _cache.database.value;
}
/**
* The client of the cache's own database, or the shared client when there is
* none.
*/
const useCacheRedis = () => {
	const database = cacheRedisDatabase();
	if (database === void 0) return useRedis();
	_cache.redis ??= createRedis(database);
	return _cache.redis;
};
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
async function flushCacheRedisDatabase(queueAfterFlush) {
	if (useEnv()["CACHE_STORE"] !== "redis" || cacheRedisDatabase() === void 0) return "not-flushed";
	const flushTransaction = useCacheRedis().multi().flushdb("ASYNC");
	queueAfterFlush?.(flushTransaction);
	let transactionReplies;
	try {
		transactionReplies = await flushTransaction.exec();
	} catch (error) {
		useLogger().warn(error, `[cache] FLUSHDB refused, clearing the cache key by key: ${error}`);
		return "not-flushed";
	}
	let databaseFlush = "flushed";
	for (const [error] of transactionReplies?.slice(1) ?? []) if (error) {
		databaseFlush = "flushed-queued-command-failed";
		useLogger().warn(error, `[cache] FLUSHDB ran, a command queued after it failed: ${error}`);
	}
	return databaseFlush;
}

//#endregion
export { _cache, cacheRedisDatabase, flushCacheRedisDatabase, useCacheRedis };