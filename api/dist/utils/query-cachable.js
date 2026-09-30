//#region src/utils/query-cachable.ts
/**
* `$NOW`/`$NOW(...)` is resolved to a `Date` by `parseFilter` (in `sanitizeQuery`)
* before this runs — static dates stay strings, `$CURRENT_*` resolve to ids — so a
* `Date` anywhere in the resolved query marks a time-dynamic read. Recurses objects
* + arrays; null-safe.
*/
function hasResolvedDynamicDate(node) {
	if (node instanceof Date) return true;
	if (Array.isArray(node)) return node.some(hasResolvedDynamicDate);
	if (node !== null && typeof node === "object") return Object.values(node).some(hasResolvedDynamicDate);
	return false;
}
/**
* Whether it's worth caching a read with this (already dynamic-var-resolved) query.
* NOT a staleness guard: the resolved `$NOW` Date is part of the cache key, so each
* request already keys distinctly and never serves a stale HIT. It's hygiene — a
* time-dynamic key never recurs, so caching it only writes a never-hit entry (Redis
* bloat, a bloated scoped-purge tag set, skewed stats). Scans the whole query, so it
* covers the root filter and `deep._filter`. See [[query-now-not-poison]].
*/
function queryCachable(query) {
	return !hasResolvedDynamicDate(query);
}

//#endregion
export { queryCachable };