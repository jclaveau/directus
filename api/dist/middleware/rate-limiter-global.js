import async_handler_default from "../utils/async-handler.js";
import { useLogger } from "../logger/index.js";
import { validateEnv } from "../utils/validate-env.js";
import { createRateLimiter } from "../rate-limiter.js";
import { useEnv } from "@directus/env";
import { HitRateLimitError } from "@directus/errors";

//#region src/middleware/rate-limiter-global.ts
const RATE_LIMITER_GLOBAL_KEY = "global-rate-limit";
const env = useEnv();
const logger = useLogger();
let checkRateLimit = (_req, _res, next) => next();
let rateLimiterGlobal;
if (env["RATE_LIMITER_GLOBAL_ENABLED"] === true) {
	validateEnv(["RATE_LIMITER_GLOBAL_DURATION", "RATE_LIMITER_GLOBAL_POINTS"]);
	validateConfiguration();
	rateLimiterGlobal = createRateLimiter("RATE_LIMITER_GLOBAL");
	checkRateLimit = async_handler_default(async (_req, res, next) => {
		try {
			await rateLimiterGlobal.consume(RATE_LIMITER_GLOBAL_KEY, 1);
		} catch (rateLimiterRes) {
			if (rateLimiterRes instanceof Error) throw rateLimiterRes;
			res.set("Retry-After", String(Math.round(rateLimiterRes.msBeforeNext / 1e3)));
			throw new HitRateLimitError({
				limit: +env["RATE_LIMITER_GLOBAL_POINTS"],
				reset: new Date(Date.now() + rateLimiterRes.msBeforeNext)
			});
		}
		next();
	});
}
var rate_limiter_global_default = checkRateLimit;
function validateConfiguration() {
	if (env["RATE_LIMITER_ENABLED"] !== true) {
		logger.error(`The IP based rate limiter needs to be enabled when using the global rate limiter.`);
		process.exit(1);
	}
	if (Number(env["RATE_LIMITER_GLOBAL_POINTS"]) / Math.max(Number(env["RATE_LIMITER_GLOBAL_DURATION"]), 1) <= Number(env["RATE_LIMITER_POINTS"]) / Math.max(Number(env["RATE_LIMITER_DURATION"]), 1)) {
		logger.error(`The global rate limiter needs to allow more requests per second than the IP based rate limiter.`);
		process.exit(1);
	}
}

//#endregion
export { rate_limiter_global_default as default, rateLimiterGlobal };