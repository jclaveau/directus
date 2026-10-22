---
name: project_directus_permissions_cache_namespace
description: Permissions multi cache used fixed namespace `permissions` on shared Redis (not CACHE_NAMESPACE) — cross-deployment clears + stale-answer risk; root cause of cache-purge-redis-commands flake (PR #602)
metadata:
  author: Jean Claveau
  type: project
---

`api/src/permissions/cache.ts` built its multi cache with `namespace: 'permissions'` on the shared `useRedis()` client. Bus and lock follow `CACHE_NAMESPACE` ([[project_directus_deployment_namespace_bus_lock]]); this cache did not. Fix: `` `${CACHE_NAMESPACE}:permissions` ``.

**Why:** two instances on one Redis (bb shard: other files' instances on 6108) share the permission keys AND the clear-bus channel. A sibling's system-cache clear empties our local tier; our next PATCH re-does 4 permission lookups = 4x(get,set,publish) with key `''`, which `countRedisCommands` counts → `cache-purge-redis-commands.test.ts` fails `expected (18) to equal (15)`. Same signature in 5 failed CI jobs. Product side: deployments sharing a Redis with overlapping ids (PR db cloned from dev) can serve each other's permission answer = stale cache, HIGH.

**How to apply:** flake signature = extra unnamespaced get/set/publish x4 in the MONITOR count → look for a fixed-namespace cache on the shared client. Any new cache/bus on `useRedis()` must prefix CACHE_NAMESPACE. Regression: unit `api/src/permissions/cache.test.ts` (namespace follows env) + bb scenario "second deployment clears its system cache before the counted write" (test commit 4d281d8429 pushed first for red proof, fix b62afba173). Worktree can't run validate-access.test.ts (no packages/specs dist) — CI only. See [[project_directus_blackbox_flakes]].

**Deploy/rollback window (MERGED #602 as 68832078de, 2026-10-09).** Permission entries have NO TTL (`withCache` sets without one; `@directus/memory` redis `set` takes none), so old `permissions:*` keys are orphaned forever, not expiring. First deploy carrying the fix = one-time split-clear window (old node revokes into the old namespace); rollback opens it again in reverse and revives a reader of the orphans. `CACHE_AUTO_FLUSH_ON_DEPLOY` boot flush (`flushCaches(true)` → `clearSystemCache` → `clearPermissionCache`) runs before listen: covers the rollback reader, NOT the overlap. jean's ruling: disclose (no permission edits during that deploy, or one clear after), no old-channel listener. Settled, don't re-raise.
