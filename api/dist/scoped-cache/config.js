import { useRedis } from "../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../redis/utils/redis-config-available.js";
import "../redis/index.js";
import { useEnv } from "@directus/env";

//#region src/scoped-cache/config.ts
const env = useEnv();
/**
* Whether scoped (tag-based) cache purging is active. Requires the opt-in mode AND a
* Redis cache store, since the tag→keys index lives in Redis sets. Any other config
* falls back to full flush.
*
* Here rather than beside the purge it gates: every file in this module asks it,
* including the ones the purge itself depends on, and a predicate that answers from
* the environment alone is what lets them without importing each other.
*/
function scopedCachePurgeEnabled() {
	return env["CACHE_AUTO_PURGE_MODE"] === "scoped" && env["CACHE_STORE"] === "redis" && redisConfigAvailable();
}
/**
* Fail fast at startup: scoped cache purging drives Redis SCAN + multi-key DEL over
* a single node, so it only works on a standalone client. A cluster client would
* silently under-purge (keys on other nodes never scanned) and leave stale slices.
* `useRedis()` always builds a standalone `Redis` in core, so this only bites a
* custom override — surface it at boot rather than as a mid-request stale HIT.
*/
function assertScopedCacheRedisSupported() {
	if (scopedCachePurgeEnabled() && useRedis().isCluster) throw new Error("CACHE_AUTO_PURGE_MODE=scoped is not implemented for Redis cluster clients (SCAN and multi-key DEL are single-node). Use a standalone Redis or CACHE_AUTO_PURGE_MODE=full.");
}

//#endregion
export { assertScopedCacheRedisSupported, scopedCachePurgeEnabled };