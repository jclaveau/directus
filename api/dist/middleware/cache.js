import async_handler_default from "../utils/async-handler.js";
import { useLogger } from "../logger/index.js";
import { getCache, getCacheValue } from "../cache.js";
import { useBufferedCounter } from "../telemetry/counter/use-buffered-counter.js";
import { getEntitlementManager } from "../license/entitlements/manager.js";
import { shouldSkipCache } from "../utils/should-skip-cache.js";
import { getCacheControlHeader } from "../utils/get-cache-headers.js";
import { getCacheKey } from "../utils/get-cache-key.js";
import "../license/index.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/middleware/cache.ts
const checkCacheMiddleware = async_handler_default(async (req, res, next) => {
	const env = useEnv();
	const { cache } = getCache();
	const logger = useLogger();
	const entitlementManager = getEntitlementManager();
	if (req.method.toLowerCase() !== "get" && req.originalUrl?.startsWith("/graphql") === false) return next();
	if (env["CACHE_ENABLED"] !== true) return next();
	if (!cache) return next();
	if (shouldSkipCache(req)) {
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
		return next();
	}
	const key = await getCacheKey(req);
	let cachedData;
	try {
		cachedData = await getCacheValue(cache, key);
	} catch (err) {
		logger.warn(err, `[cache] Couldn't read key ${key}. ${err.message}`);
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
		return next();
	}
	if (cachedData) {
		let cacheExpiryDate;
		try {
			cacheExpiryDate = (await getCacheValue(cache, `${key}__expires_at`))?.exp;
		} catch (err) {
			logger.warn(err, `[cache] Couldn't read key ${`${key}__expires_at`}. ${err.message}`);
			if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
			return next();
		}
		const cacheTTL = cacheExpiryDate ? cacheExpiryDate - Date.now() : void 0;
		res.setHeader("Cache-Control", getCacheControlHeader(req, cacheTTL, true, true));
		res.setHeader("Vary", "Origin, Cache-Control");
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "HIT");
		if (entitlementManager.isEntitled("telemetry_required") || toBoolean(env["TELEMETRY"])) try {
			useBufferedCounter("api-requests").increment("cached");
		} catch (err) {
			logger.trace(err, "Failed to increment cached request counter");
		}
		return res.json(cachedData);
	} else {
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
		return next();
	}
});
var cache_default = checkCacheMiddleware;

//#endregion
export { cache_default as default };