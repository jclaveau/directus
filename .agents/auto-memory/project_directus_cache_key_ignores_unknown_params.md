---
name: project_directus_cache_key_ignores_unknown_params
description: The response-cache key is path + sanitizedQuery + user — an invented query param never reaches it, so varying reads by one silently produces a single cache key
metadata:
  type: project
---

`getCacheKey` (`api/src/utils/get-cache-key.ts`) composes the key from
`url.parse(req.originalUrl).pathname` — **pathname only, the query string is not in it** —
plus `req.accountability?.user` and `req.sanitizedQuery`. And `sanitizeQuery`
(`api/src/utils/sanitize-query.ts`) builds a fresh `const query: Query = {}`, copying only
the parameters it knows: `fields`, `filter`, `sort`, `limit`, `offset`, `page`, `search`,
`group`, `aggregate`, `deep`, `alias`, `export`, `version`, `meta`.

**An unrecognised query parameter is therefore invisible to the cache key.**

**Why:** a blackbox test varied its reads with `?rateLimiterChargeKey=a|b|c` to force
distinct cache entries. All of them collapsed onto one key, so reads meant to be misses were
hits: the assertion that a miss past the budget still 429s got a 200, and the case above it
passed vacuously. Also worth knowing for the feature itself — two callers differing only by
an unknown param share a cached response.

**How to apply:**
- To vary a cache key in a test, vary a **sanitized** parameter — `?fields=id` vs
  `?fields=email` is the cheapest, and works on `/users/me` with no fixtures.
- Assert the `CACHE_STATUS_HEADER` (`MISS` then `HIT`) so a run that cached nothing cannot
  pass vacuously ([[feedback_mock_fixture_and_dom_false_positive]]).
- The key carries no IP, so cache entries are shared across `X-Forwarded-For` values — per-IP
  isolation in a test isolates the *rate-limit bucket*, never the cache. Two instances with
  different `CACHE_NAMESPACE` are the cache isolation boundary.
- Only exception: `ip` joins the key when a policy has an `ip_access` filter matching it.
