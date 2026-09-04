import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { warnOncePerConnectionOutage } from "./redis/lib/warn-once-per-connection-outage.js";
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
	delete config.enabled;
	delete config.store;
	merge(config, overrides || {});
	if (store === "redis") {
		config.storeClient = new (require("ioredis"))(useEnv()[`REDIS`] || getConfigFromEnv(`REDIS_`));
		const limiterLabel = configPrefix.toLowerCase().replace(/_/g, "-");
		warnOncePerConnectionOutage(config.storeClient, limiterLabel);
		config.insuranceLimiter = new RateLimiterMemory({
			points: Number.MAX_SAFE_INTEGER,
			duration: 1
		});
		config.rejectIfRedisNotReady = true;
	}
	return config;
}

//#endregion
export { RateLimiterRes, createRateLimiter };