import { shouldSkipCache } from "./should-skip-cache.js";
import { useEnv } from "@directus/env";

//#region src/utils/get-cache-headers.ts
/**
* Returns the Cache-Control header for the current request
*
* @param req Express request object
* @param ttl TTL of the cache in ms
* @param globalCacheSettings Whether requests are affected by the global cache settings (i.e. for dynamic API requests)
* @param personalized Whether requests depend on the authentication status of users
*/
function getCacheControlHeader(req, ttl, globalCacheSettings, personalized) {
	const env = useEnv();
	if (shouldSkipCache(req)) return "no-store";
	if (ttl === void 0 || ttl < 0) return "no-cache";
	if (globalCacheSettings && env["CACHE_AUTO_PURGE"] === true) return "no-cache";
	const headerValues = [];
	if (personalized) {
		const access = !!req.accountability?.role === false ? "public" : "private";
		headerValues.push(access);
	}
	const ttlSeconds = Math.round(ttl / 1e3);
	headerValues.push(`max-age=${ttlSeconds}`);
	if (globalCacheSettings && Number.isInteger(env["CACHE_CONTROL_S_MAXAGE"]) && env["CACHE_CONTROL_S_MAXAGE"] >= 0) headerValues.push(`s-maxage=${env["CACHE_CONTROL_S_MAXAGE"]}`);
	return headerValues.join(", ");
}

//#endregion
export { getCacheControlHeader };