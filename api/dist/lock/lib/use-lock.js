import { useRedis } from "../../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../../redis/utils/redis-config-available.js";
import "../../redis/index.js";
import { useEnv } from "@directus/env";
import { createKv } from "@directus/memory";

//#region src/lock/lib/use-lock.ts
const _cache = { lock: void 0 };
/**
* Returns globally shared lock kv instance.
*/
const useLock = () => {
	if (_cache.lock) return _cache.lock;
	if (redisConfigAvailable()) {
		const env = useEnv();
		_cache.lock = createKv({
			type: "redis",
			redis: useRedis(),
			namespace: env["REDIS_LOCK_NAMESPACE"] ?? "directus:lock"
		});
	} else _cache.lock = createKv({ type: "local" });
	return _cache.lock;
};

//#endregion
export { _cache, useLock };