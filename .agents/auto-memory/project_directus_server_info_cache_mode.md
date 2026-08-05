---
name: project_directus_server_info_cache_mode
description: /server/info opts out of the response cache in SCOPED purge mode only — it stays cacheable under full purge; so it can no longer provoke missing_scope, use GET /graphql?query={__typename} instead
metadata:
  type: project
---

`api/src/controllers/server.ts` `/info` gates its cache opt-out on
`scopedCachePurgeEnabled()`:

- **scoped purge** → `res.locals['cache'] = false`. `serverInfo()` reads
  `directus_settings` through a service call the tagging pipeline can't tag, and returns
  env/version fields no write event invalidates → caching it would orphan an entry and
  raise a `missing_scope` anomaly an operator can never clear.
- **full purge** → left alone, i.e. cacheable. A mutation clears the whole cache, so
  nothing can go stale; opting out there dropped a cacheable response for nothing.

`778db91b3a` originally opted out **unconditionally**, which is what jean corrected
("/server/info should remain cacheable in full purge mode as it was previously").

**Consequence for tests:** `/server/info` can no longer provoke a `missing_scope`
anomaly — in scoped mode it isn't cacheable at all, and `missing_scope` fires only for
a **cacheable** collection-less response (`respond.ts`: `cacheableRequest &&
orphansInScopedMode`).

The provoker is **`GET /graphql?query={__typename}`** → `{"data":{"__typename":"Query"}}`,
31 bytes, no collection, no scope tags. `/server/specs/oas` does NOT work: **152 904
bytes** on a near-empty schema, and `respond.ts` reports `exceedsMaxSize` **before**
`orphansInScopedMode`, so under the anomaly server's `CACHE_VALUE_MAX_SIZE=8kb` it lands
as `value_too_large` and collides with the oversized provoker in the same test. That
cost a full CI round: I had validated the OAS spec against the local dev API, which sets
**no value cap** — the probe couldn't see the reason that actually wins.

**Why:** the blackbox suite has asserted the mode split since #298 ("the skip is
scoped-mode-only") but is label-gated and had never run, so the unconditional opt-out
went unnoticed for a week. Confirmed pre-existing via an empty commit on the base.

Related: [[project_directus_schema_read_cache_tagging]], [[project_directus_pr326_latency_percentiles]].
