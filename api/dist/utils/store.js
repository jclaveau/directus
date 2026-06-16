import { useRedis } from "../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../redis/utils/redis-config-available.js";
import "../redis/index.js";
import { createCache } from "@directus/memory";

//#region src/utils/store.ts
/**
* Shared memory between multiple instances. Scoped to a provided namespace in redis.
*/
function useStore(namespace, options) {
	const config = redisConfigAvailable() === false ? { type: "local" } : {
		type: "redis",
		namespace,
		redis: useRedis()
	};
	if (options?.ttl) config.ttl = options?.ttl;
	const store = createCache(config);
	return (callback) => store.usingLock(`lock`, async () => {
		return await callback({
			has(key) {
				return store.has(String(key));
			},
			async get(key) {
				return await store.get(String(key)) ?? options?.defaults?.[key];
			},
			set(key, value) {
				return store.set(String(key), value);
			},
			delete(key) {
				return store.delete(String(key));
			}
		});
	});
}

//#endregion
export { useStore };