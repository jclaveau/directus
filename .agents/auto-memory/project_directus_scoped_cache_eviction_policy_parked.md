---
name: project_directus_scoped_cache_eviction_policy_parked
description: PARKED 2026-09-30 — scoped purge trusts the index-key registry; an evicting Redis maxmemory-policy can drop a registry set while its entry lives → stale HIT; proposed boot guard requiring noeviction
metadata:
  type: project
---

PARKED (jean, 2026-09-30, during #578 review). Since #578 a purge SSCANs the
`collection-index-keys:*` registry whenever the completeness marker equals the
index generation. Under `maxmemory-policy` `volatile-*` / `allkeys-*`, Redis can
evict a registry set (it carries a TTL) while the entry it names stays live →
the marker lies → purge misses the entry → **stale HIT (HIGH severity)**.
Marker location (cache DB vs shared DB) changes nothing here.

Prod measured `maxmemory 0` + `noeviction` (2026-08-26, see
[[project_directus_prod_cache_measurement]]), so it is a config risk, not a live bug.
Not verified whether code already refuses scoped purge under an evicting policy.

**Why:** the marker has no invalidation path besides the generation move on a
build change (settled in #578: FLUSHDB, drop, failed fill, failover need none).
Eviction is the one case left outside #578's own logic.

**How to apply:** revive as its own issue — candidate fix: at boot, `CONFIG GET
maxmemory-policy` on the cache Redis and refuse (or fall back to SCAN-always) unless
`noeviction`. Mind managed Redis that forbids CONFIG. See
[[project_directus_pr534_purge_scaling_578]].
