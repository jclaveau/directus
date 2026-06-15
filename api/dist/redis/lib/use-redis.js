import { createRedis } from "./create-redis.js";
import { Redis } from "ioredis";

//#region src/redis/lib/use-redis.ts
/**
* Memoization cache for useRedis
*
* @see {@link useRedis}
*/
const _cache = { redis: void 0 };
/**
* Access the globally shared Redis instance
* Creates new Redis instance on first invocation
*
* @returns Globally shared Redis instance
*/
const useRedis = () => {
	if (_cache.redis) return _cache.redis;
	_cache.redis = createRedis();
	return _cache.redis;
};

//#endregion
export { _cache, useRedis };