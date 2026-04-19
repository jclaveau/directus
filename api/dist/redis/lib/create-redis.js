import { getConfigFromEnv } from "../../utils/get-config-from-env.js";
import { useEnv } from "@directus/env";
import { Redis } from "ioredis";

//#region src/redis/lib/create-redis.ts
/**
* Create a new Redis instance based on the global env configuration
*
* @returns New Redis instance based on global configuration
*/
const createRedis = () => {
	return new Redis(useEnv()["REDIS"] ?? getConfigFromEnv("REDIS"));
};

//#endregion
export { createRedis };