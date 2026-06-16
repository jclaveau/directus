import { useRedis } from "../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../redis/utils/redis-config-available.js";
import "../redis/index.js";
import { getMilliseconds } from "../utils/get-milliseconds.js";
import { useEnv } from "@directus/env";
import { defineCache } from "@directus/memory";

//#region src/permissions/cache.ts
const localOnly = redisConfigAvailable() === false;
const env = useEnv();
const ttl = getMilliseconds(env["CACHE_SYSTEM_TTL"]);
const config = localOnly ? {
	type: "local",
	maxKeys: 500
} : {
	type: "multi",
	redis: {
		namespace: env["REDIS_PERMISSIONS_NAMESPACE"] ?? "permissions",
		redis: useRedis(),
		...ttl !== void 0 ? { ttl } : {}
	},
	local: { maxKeys: 100 }
};
const useCache = defineCache(config);
function clearCache() {
	return useCache().clear();
}

//#endregion
export { clearCache, useCache };