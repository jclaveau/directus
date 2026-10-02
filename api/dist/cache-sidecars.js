//#region src/cache-sidecars.ts
/**
* A cached response is stored as three keys: the payload and two sidecars,
* carrying what a HIT needs without a second read. `respond` writes them, the
* cache middleware and the entry endpoint read them, `evictCacheEntry` drops
* them together.
*
* Their names live in a module of their own because the scoped cache has to
* recognise a sidecar as well — a purge must not count one as an eviction of its
* own, nor name one as an entry left stale — and `cache.ts` already imports
* `scoped-cache/purge.ts`, so the shared vocabulary has to sit below both.
*/
const EXPIRES_AT_SUFFIX = "__expires_at";
const PINS_SUFFIX = "__pins";
/** Where a HIT reads an entry's age, TTL and expiry from. */
function cacheExpiresAtKey(redisKey) {
	return `${redisKey}${EXPIRES_AT_SUFFIX}`;
}
/** The dev-only sibling holding an entry's scoped-cache pins. */
function cachePinsKey(redisKey) {
	return `${redisKey}${PINS_SUFFIX}`;
}
/** The entry a sidecar belongs to, or null when the key is not one. */
function cacheSidecarOwner(member) {
	const suffix = [EXPIRES_AT_SUFFIX, PINS_SUFFIX].find((candidate) => member.endsWith(candidate));
	return suffix === void 0 ? null : member.slice(0, -suffix.length);
}
/**
* The labels the `__pins` sidecar holds, or null when it holds anything else — an
* entry written before the sidecar listed them, or a store answering garbage —
* so nothing flattens into a garbled header or listing.
*/
function storedScopedCachePinLabels(stored) {
	const pins = stored?.pins;
	if (!Array.isArray(pins) || pins.length === 0) return null;
	return pins.every((pin) => typeof pin === "string") ? pins : null;
}

//#endregion
export { cacheExpiresAtKey, cachePinsKey, cacheSidecarOwner, storedScopedCachePinLabels };