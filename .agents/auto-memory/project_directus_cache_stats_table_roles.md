---
name: project_directus_cache_stats_table_roles
description: which cache-stats tables are pure telemetry vs load-bearing (both scoped_cache tag tables are telemetry — Redis is the mechanism), their reapers, which two are Timescale hypertables, and that the byte budget measures only directus_cache_events
metadata:
  type: project
---

Checked in source 2026-08-20, before proposing any fix that truncates them.

**Neither tag table is load-bearing. Both are pure telemetry.**
- Every reference outside their migration lives in `api/src/cache-events.ts`.
  Nothing in `scoped-cache.ts`, `cache.ts` or `services/items.ts` reads them.
- The live purge index is the Redis `scalabus:tag:*` sets — these tables MIRROR it.
- Sole reader: `scopedCachePurgeCoverage()` → `listPurgesCoveringEntry()`, the cache
  page's "which purges covered this entry" join.
- `directus_scoped_cache_purge_tags` = fact half (row per purge × tag, timestamped).
  `directus_scoped_cache_entry_tags` = dimension half (row per cache key × tag, no
  time column).
- So truncating either costs that one admin-page join and costs cache correctness
  nothing — which is what makes an aggressive budget safe.

**Everything is reaped — they are NOT unbounded** (I wrongly said so once):
`reapCacheEvents`, `reapCachePurges`, `reapScopedCachePurgeTags` cut on
`retentionMs()` (`CACHE_STATS_RETENTION`, default 30d);
`reapScopedCacheEntryTags` follows the descriptors out on an orphan rule;
`reapCacheDescriptors` uses its own 90d window + orphan rule.

**Sizes / shape (prod, 2026-08-20):** `purge_tags` 1449 MB (plain), `descriptors`
310 MB (plain), `entry_tags` 167 MB (plain), `cache_events` 226 MB and
`cache_purges` 64 MB — those two are **Timescale hypertables**, so
`pg_total_relation_size` on the parent reads ~16 kB; use
`hypertable_detailed_size()`. `eventsTableBytes()` measures ONLY
`directus_cache_events`, which is why 1.9 GB sits outside the budget (**#376**).

Effective retention looked like ~14d from the data (oldest `cache_events` row
08-06, no deploy that day), not the 30d default.

Related: [[project_directus_cache_stats_prod_incident]], [[project_directus_blackbox_coverage]].
