import { useRedis } from "../../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../../redis/utils/redis-config-available.js";
import "../../redis/index.js";
import { useEnv } from "@directus/env";
import { createKv } from "@directus/memory";

//#region src/lock/lib/use-lock.ts
const _cache = { lock: void 0 };
/**
* Returns globally shared lock kv instance.
*
* Named after the deployment, like the bus: a node that finds the schema
* build lock taken waits on the bus for the holder's build, so a lock shared
* wider than the bus would have it listening for a message another
* deployment publishes out of its hearing.
*/
const useLock = () => {
	if (_cache.lock) return _cache.lock;
	if (redisConfigAvailable()) _cache.lock = createKv({
		type: "redis",
		redis: useRedis(),
		namespace: `${useEnv()["CACHE_NAMESPACE"]}:lock`
	});
	else _cache.lock = createKv({ type: "local" });
	return _cache.lock;
};

//#endregion
export { _cache, useLock };