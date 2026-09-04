import { getMilliseconds } from "../utils/get-milliseconds.js";
import { useLogger } from "../logger/index.js";
import { useMetrics } from "../metrics/lib/use-metrics.js";
import "../metrics/index.js";
import { resolvedCacheTtl } from "../cache-config.js";
import { printableScopedCacheTags } from "../utils/printable-scoped-cache-tags.js";
import { cacheStatsActive, queueCacheHit, queueCacheMiss, readCacheMissGap } from "../cache-events.js";
import { getCache, getCacheValue } from "../cache.js";
import async_handler_default from "../utils/async-handler.js";
import { shouldSkipCache } from "../utils/should-skip-cache.js";
import { getCacheControlHeader } from "../utils/get-cache-headers.js";
import { getCacheKey } from "../utils/get-cache-key.js";
import { reportCacheAnomaly } from "../utils/report-cache-anomaly.js";
import { useEnv } from "@directus/env";

//#region src/middleware/cache.ts
const checkCacheMiddleware = async_handler_default(async (req, res, next) => {
	const env = useEnv();
	const { cache } = getCache();
	const logger = useLogger();
	if (req.method.toLowerCase() !== "get" && req.originalUrl?.startsWith("/graphql") === false) return next();
	if (env["CACHE_ENABLED"] !== true) return next();
	if (!cache) return next();
	res.locals["requestStart"] = Date.now();
	if (shouldSkipCache(req)) {
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
		return next();
	}
	const { redisKey, cacheKey } = await getCacheKey(req);
	let cachedData;
	try {
		cachedData = await getCacheValue(cache, redisKey);
	} catch (err) {
		logger.warn(err, `[cache] Couldn't read key ${redisKey}. ${err.message}`);
		if (cacheStatsActive()) reportCacheAnomaly(req, "redis_error", err?.message ?? String(err)).catch(() => {});
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
		return next();
	}
	if (cachedData) {
		let cacheExpiryDate;
		let expiresMeta;
		try {
			expiresMeta = await getCacheValue(cache, `${redisKey}__expires_at`);
			cacheExpiryDate = expiresMeta?.exp;
		} catch (err) {
			logger.warn(err, `[cache] Couldn't read key ${redisKey}__expires_at. ${err.message}`);
			if (cacheStatsActive()) reportCacheAnomaly(req, "redis_error", err?.message ?? String(err)).catch(() => {});
			if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
			return next();
		}
		const cacheTTL = cacheExpiryDate ? cacheExpiryDate - Date.now() : void 0;
		res.setHeader("Cache-Control", getCacheControlHeader(req, cacheTTL, true, true));
		res.setHeader("Vary", "Origin, Cache-Control");
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "HIT");
		useMetrics()?.getCacheResponseMetric()?.inc({ result: "hit" });
		const createdAt = Number(expiresMeta?.createdAt ?? 0);
		if (cacheStatsActive() && createdAt > 0) queueCacheHit({
			cacheKey,
			ageMs: Math.max(Date.now() - createdAt, 0),
			ttlMs: expiresMeta?.ttlMs ?? null,
			durationMs: Math.max(Date.now() - Number(res.locals["requestStart"]), 0)
		}).catch(() => {});
		if (env["CACHE_TAGS_HEADER"]) try {
			const stored = await getCacheValue(cache, `${redisKey}__tags`);
			if (typeof stored?.tags === "string" && stored.tags !== "") res.setHeader(`${env["CACHE_TAGS_HEADER"]}`, printableScopedCacheTags(stored.tags));
		} catch (err) {
			logger.warn(err, `[cache] __tags read failed: ${err.message}`);
		}
		return res.json(cachedData);
	} else {
		if (env["CACHE_STATUS_HEADER"]) res.setHeader(`${env["CACHE_STATUS_HEADER"]}`, "MISS");
		useMetrics()?.getCacheResponseMetric()?.inc({ result: "miss" });
		if (cacheStatsActive()) readCacheMissGap(redisKey, Date.now()).then((gapMs) => {
			return queueCacheMiss({
				cacheKey,
				gapMs,
				ttlMs: getMilliseconds(resolvedCacheTtl()) ?? null
			});
		}).catch(() => {});
		return next();
	}
});
var cache_default = checkCacheMiddleware;

//#endregion
export { cache_default as default };