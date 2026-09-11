import { useEnv } from "@directus/env";

//#region src/redis/utils/redis-config-available.ts
/**
* Check if Redis configuration exists in the current project's environment configuration
*/
const redisConfigAvailable = () => {
	const env = useEnv();
	if ("REDIS_ENABLED" in env) return env["REDIS_ENABLED"] === true;
	return "REDIS" in env || Object.keys(env).some((key) => key.startsWith("REDIS_"));
};

//#endregion
export { redisConfigAvailable };