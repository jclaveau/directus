import { useRedis } from "../../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../../redis/utils/redis-config-available.js";
import "../../redis/index.js";
import { createBus } from "@directus/memory";

//#region src/bus/lib/use-bus.ts
const _cache = { bus: void 0 };
/**
* Returns globally shared message bus. If Redis is available, will use a redis-driven pub/sub bus.
* Otherwise will default to a local-only bus.
*/
const useBus = () => {
	if (_cache.bus) return _cache.bus;
	if (redisConfigAvailable()) _cache.bus = createBus({
		type: "redis",
		redis: useRedis(),
		namespace: "directus:bus"
	});
	else _cache.bus = createBus({ type: "local" });
	return _cache.bus;
};

//#endregion
export { _cache, useBus };