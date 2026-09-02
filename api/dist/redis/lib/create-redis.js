import { getConfigFromEnv } from "../../utils/get-config-from-env.js";
import { warnOncePerConnectionOutage } from "./warn-once-per-connection-outage.js";
import { useEnv } from "@directus/env";
import { Redis } from "ioredis";

//#region src/redis/lib/create-redis.ts
/**
* ioredis' reconnect policy is a function, so it can't be set through the env like the other
* `REDIS_*` scalar options. Build one from exposed scalar knobs instead, so a serverless host
* (e.g. Railway app-sleeping, which only sleeps a service after 10 min with no outbound packets)
* can widen the reconnect gap — or stop reconnecting — once Redis is unreachable, and be allowed
* to idle out instead of being held awake by an endless reconnect loop.
*
* Defaults reproduce ioredis' built-in strategy (unlimited retries, 50ms..2000ms backoff), so an
* unconfigured deployment behaves exactly as before.
*
* - REDIS_RETRY_BASE_DELAY   backoff step in ms per attempt        (default 50)
* - REDIS_RETRY_MAX_DELAY    backoff cap in ms                     (default 2000)
* - REDIS_RETRY_MAX_ATTEMPTS stop reconnecting after N attempts    (default unset = unlimited)
*
* Serverless recipe: a large REDIS_RETRY_MAX_DELAY (e.g. `number:900000`) keeps the client
* self-healing but spaces attempts far enough apart to clear the sleep window. REDIS_RETRY_MAX_
* ATTEMPTS hard-stops reconnection — use with care: ioredis will not reconnect on its own after
* giving up, so it only suits short-lived processes, not the long-running API.
*/
function retryStrategyFromEnv() {
	const env = useEnv();
	const baseDelay = toMs(env["REDIS_RETRY_BASE_DELAY"], 50);
	const maxDelay = toMs(env["REDIS_RETRY_MAX_DELAY"], 2e3);
	const maxAttempts = toCount(env["REDIS_RETRY_MAX_ATTEMPTS"]);
	return (attempt) => {
		if (maxAttempts !== void 0 && attempt > maxAttempts) return null;
		return Math.min(attempt * baseDelay, maxDelay);
	};
}
function toMs(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function toCount(value) {
	if (value === void 0 || value === null || value === "") return;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : void 0;
}
/**
* Create a new Redis instance based on the global env configuration
*
* @returns New Redis instance based on global configuration
*/
const createRedis = () => {
	const env = useEnv();
	const options = { retryStrategy: retryStrategyFromEnv() };
	const redis = env["REDIS"] ? new Redis(env["REDIS"], options) : new Redis({
		...getConfigFromEnv("REDIS"),
		...options
	});
	warnOncePerConnectionOutage(redis, "redis");
	return redis;
};

//#endregion
export { createRedis };