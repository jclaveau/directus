---
name: reference_directus_query_now_not_cache_poison
description: query-filter $NOW does NOT poison the response cache — sanitizeQuery resolves it to a Date before the key is built; only permission-side $NOW is a staleness vector
metadata:
  type: reference
---

`$NOW` in a user QUERY filter (`?filter[x][_gte]=$NOW`) does **not** cause a stale cache HIT. Mis-analysed as a poison ≥2×; re-verify against this before ever re-raising it.

- `sanitizeQuery` middleware (`api/src/middleware/sanitize-query.ts`) runs BEFORE the cache middleware and calls `parseFilter`, which resolves `$NOW` → a concrete `new Date()` (proof: `packages/utils/shared/parse-filter.test.ts` — `{_eq:'$NOW(-1 day)'}` → `{_eq: new Date(...)}`).
- `req.sanitizedQuery.filter` is frozen holding that Date. `getCacheKey` (`api/src/utils/get-cache-key.ts`) = `hash(version, user, path=pathname-ONLY, query=req.sanitizedQuery)` — `path = url.parse(originalUrl).pathname` strips the query string, so literal `$NOW` is nowhere in the key; the resolved Date is.
- ⇒ every request keys distinctly (verified: two filters 1ms apart hash distinct) → MISS → fresh data. No staleness.

Contrast the permission side: `permissionsCachable` IS a real staleness guard because the permission filter is NOT part of the cache key (key carries `user`, not the ruleset) — a cached permission-`$NOW` response would freeze. Query-side vs permission-side are OPPOSITE, not symmetric.

What query-`$NOW` actually costs (fixed in PR #291, issue #284): its key never recurs, so caching writes a never-hit entry → Redis bloat, scoped-purge tag-set inflation (`respond.ts:tagScopedCacheKeys` adds each dead key to the bare `tag:<collection>` set → every collection write SMEMBERS+DELs them), stats pollution. #291's `queryCachable(sanitizedQuery)` skips it as HYGIENE, NOT a staleness fix. Skip is SILENT (no anomaly): an anomaly's key IS the per-request-unique cache hash → the throttle can't dedupe → reporting would re-create the same bloat in the stats tables. Dropped it for KISS rather than build a stable group-key.

DETECTION GOTCHA (cost me a no-op gate first): by the time the gate runs, `$NOW` is ALREADY resolved to a `Date` (`instanceof Date: true`) — so matching the literal string `'$NOW'` (`filter_has_now`) NEVER fires in prod; it only passed tests that fed literal strings. Correct signal = a `Date` INSTANCE anywhere in the resolved query (static dates stay strings, `$CURRENT_*` → ids, so no false positive). `queryCachable` walks the whole `sanitizedQuery` for a Date (covers root filter AND `deep._filter`), null-safe by construction. Contrast: `permissionsCachable` DOES string-match `filter_has_now` correctly because it reads permissions with `bypassDynamicVariableProcessing:true` → keeps `$NOW` literal. Different representations, different checks. See [[reference_git_nul_byte_binary_mergebase]] neighbours in cache work.

SETTLED — do NOT re-raise on a re-review (merged as #291 → `v11.10.1-hhh-dev`, squash `26db340`): (a) **no blackbox test** — the gate has NO black-box HTTP observable, since `$NOW` keys differ per request either way, so HIT/MISS can't distinguish gated from ungated (an early bb "witness" was vacuous + removed); the unit + e2e-seam tests are the coverage. (b) **silent skip, no dashboard anomaly** — deliberate KISS: reporting would re-create the bloat (see above); jean chose to DROP the feature over building a stable-group-key mechanism to support it (feature value < supporting complexity). (c) `deep._filter` IS covered. Issue #284's remaining hook-directive mechanism (forbid/addTag/maxAge — Tiers 2/3) is a separate future PR; `addTag` largely already exists as the `cache.scope` filter event.
