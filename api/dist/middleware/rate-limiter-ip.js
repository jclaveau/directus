import async_handler_default from "../utils/async-handler.js";
import { validateEnv } from "../utils/validate-env.js";
import { createRateLimiter } from "../rate-limiter.js";
import { getIPFromReq } from "../utils/get-ip-from-req.js";
import { useEnv } from "@directus/env";
import { HitRateLimitError } from "@directus/errors";

//#region src/middleware/rate-limiter-ip.ts
let checkRateLimit = (_req, _res, next) => next();
let rateLimiter;
const env = useEnv();
if (env["RATE_LIMITER_ENABLED"] === true) {
	validateEnv([
		"RATE_LIMITER_STORE",
		"RATE_LIMITER_DURATION",
		"RATE_LIMITER_POINTS"
	]);
	rateLimiter = createRateLimiter("RATE_LIMITER");
	checkRateLimit = async_handler_default(async (req, res, next) => {
		const ip = getIPFromReq(req);
		if (ip) try {
			await rateLimiter.consume(ip, 1);
		} catch (rateLimiterRes) {
			if (rateLimiterRes instanceof Error) throw rateLimiterRes;
			res.set("Retry-After", String(Math.round(rateLimiterRes.msBeforeNext / 1e3)));
			throw new HitRateLimitError({
				limit: +env["RATE_LIMITER_POINTS"],
				reset: new Date(Date.now() + rateLimiterRes.msBeforeNext)
			});
		}
		next();
	});
}
var rate_limiter_ip_default = checkRateLimit;

//#endregion
export { rate_limiter_ip_default as default, rateLimiter };