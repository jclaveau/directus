import { validateEnv } from "../utils/validate-env.js";
import { createRateLimiter } from "../rate-limiter.js";
import async_handler_default from "../utils/async-handler.js";
import { getIPFromReq } from "../utils/get-ip-from-req.js";
import { useEnv } from "@directus/env";
import { HitRateLimitError } from "@directus/errors";

//#region src/middleware/rate-limiter-ip.ts
let checkRateLimit = (_req, _res, next) => next();
let rateLimiter;
const env = useEnv();
const RATE_LIMITER_CHARGES = ["cache-misses", "every-request"];
/**
* Which requests spend a per-IP token, from `RATE_LIMITER_CHARGE`. The answer picks
* where `app.ts` registers this middleware, so it is read at boot, not per request.
*
* - `cache-misses` (default) — registered below the cache, which answers a HIT
*   without calling `next()`. The limiter guards the expensive path and a HIT is not
*   that. With caching off every request is a miss, so every request is charged.
* - `every-request` — upstream's position, above `authenticate`. Charges before the
*   cache is consulted, so a burst of cacheable reads can 429 at a 100% hit rate.
*   The trade is that an invalid-token flood is rejected before it costs a lookup.
*/
function resolvedRateLimiterCharge() {
	const charge = env["RATE_LIMITER_CHARGE"];
	if (!RATE_LIMITER_CHARGES.some((value) => value === charge)) {
		const accepted = RATE_LIMITER_CHARGES.map((value) => `"${value}"`).join(" or ");
		throw new Error(`Invalid RATE_LIMITER_CHARGE "${charge}" — expected ${accepted}`);
	}
	return charge;
}
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
export { rate_limiter_ip_default as default, rateLimiter, resolvedRateLimiterCharge };