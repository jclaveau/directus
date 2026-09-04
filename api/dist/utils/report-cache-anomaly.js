import { claimCacheAnomalyThrottleSlot, queueCacheAnomaly, queueCacheDescriptor } from "../cache-events.js";
import { getGraphqlQueryAndVariables } from "./get-graphql-query-and-variables.js";
import { getCacheKey } from "./get-cache-key.js";

//#region src/utils/report-cache-anomaly.ts
/**
* Record an anomaly for a request that was NOT cached. Claims the throttle slot
* first so a hot uncached path can't flood the stream with per-request locator
* descriptors; on a claim it writes a locator descriptor (so the anomaly's
* cache_key ref resolves to a path/method/query node in the admin tree), then the
* anomaly. bytes/fillMs are 0 — a locator, not a cached entry. Best-effort: both
* writes go to the Redis stream, so a full Redis outage records nothing.
*/
async function reportCacheAnomaly(req, reason, detail) {
	const { redisKey, cacheKey } = await getCacheKey(req);
	if (!await claimCacheAnomalyThrottleSlot(reason, cacheKey)) return;
	const isGraphQl = req.originalUrl?.startsWith("/graphql") === true;
	await queueCacheDescriptor({
		cacheKey,
		redisKey,
		coarse: false,
		method: req.method,
		path: req.originalUrl.split("?")[0],
		collection: req.collection ?? null,
		userId: req.accountability?.user ?? null,
		query: isGraphQl ? JSON.stringify(getGraphqlQueryAndVariables(req)) : JSON.stringify(req.sanitizedQuery ?? {}),
		url: isGraphQl ? "" : req.originalUrl,
		bytes: 0,
		fillMs: 0,
		scopedCacheTags: [],
		lastFilled: null
	});
	queueCacheAnomaly({
		cacheKey,
		reason,
		detail: detail ?? null
	});
}

//#endregion
export { reportCacheAnomaly };