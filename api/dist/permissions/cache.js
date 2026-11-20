import { useRedis } from "../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../redis/utils/redis-config-available.js";
import "../redis/index.js";
import { runningReads } from "./running-reads.js";
import { useEnv } from "@directus/env";
import { defineCache } from "@directus/memory";

//#region src/permissions/cache.ts
const config = redisConfigAvailable() === false ? {
	type: "local",
	maxKeys: 500
} : {
	type: "multi",
	redis: {
		namespace: `${useEnv()["CACHE_NAMESPACE"]}:permissions`,
		redis: useRedis()
	},
	local: { maxKeys: 100 }
};
const useCache = defineCache(config);
function clearCache() {
	const cache = useCache();
	runningReads.clear();
	return cache.clear();
}

//#endregion
export { clearCache, useCache };