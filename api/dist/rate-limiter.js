import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { createRequire } from "node:module";
import { useEnv } from "@directus/env";
import { merge } from "lodash-es";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";

//#region src/rate-limiter.ts
const require = createRequire(import.meta.url);
function createRateLimiter(configPrefix = "RATE_LIMITER", configOverrides) {
	switch (useEnv()["RATE_LIMITER_STORE"]) {
		case "redis": return new RateLimiterRedis(getConfig("redis", configPrefix, configOverrides));
		case "memory":
		default: return new RateLimiterMemory(getConfig("memory", configPrefix, configOverrides));
	}
}
function getConfig(store = "memory", configPrefix = "RATE_LIMITER", overrides) {
	const config = getConfigFromEnv(`${configPrefix}_`, { omitPrefix: `${configPrefix}_${store}_` });
	if (store === "redis") config.storeClient = new (require("ioredis"))(useEnv()[`REDIS`] || getConfigFromEnv(`REDIS_`));
	delete config.enabled;
	delete config.store;
	merge(config, overrides || {});
	return config;
}

//#endregion
export { RateLimiterRes, createRateLimiter };