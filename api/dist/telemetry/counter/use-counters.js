import { useRedis } from "../../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../../redis/utils/redis-config-available.js";
import "../../redis/index.js";
import { useEnv } from "@directus/env";
import { createKv } from "@directus/memory";

//#region src/telemetry/counter/use-counters.ts
const _cache = { counter: null };
/**
* Returns a shared counter kv instance, creating one if it doesn't exist.
*/
const useCounters = () => {
	if (_cache.counter) return _cache.counter;
	let counter;
	if (redisConfigAvailable()) {
		const env = useEnv();
		counter = createKv({
			type: "redis",
			redis: useRedis(),
			namespace: env["REDIS_COUNTERS_NAMESPACE"] ?? "directus:counters"
		});
	} else counter = createKv({ type: "local" });
	_cache.counter = counter;
	return counter;
};

//#endregion
export { _cache, useCounters };