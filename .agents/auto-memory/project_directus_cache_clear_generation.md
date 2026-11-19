---
name: project_directus_cache_clear_generation
description: "@directus/memory clear generation (#751): `${ns}-generation` Redis key, bumped BEFORE the key removal, setUnlessCleared Lua CAS; withCache stores and shares only a read no clear crossed"
metadata:
  type: project
---

A read that runs across a `clear()` must neither be stored nor be shared with the callers joined on it (#751, PR from branch `v11.10.1-fix/permissions-cache-generation`).

```
t0 read: getWithGeneration(k)          -> miss, gen 4 (one MGET k ns-generation)
t1 clear: INCR ns-generation (5), UNLINK ns:*
t2 read: setUnlessCleared(k, v, 4)     -> false, nothing stored, joiners re-read
```

- Key `${namespace}-generation` sits OUTSIDE the `${namespace}:*` pattern `KvRedis.clear()` SCANs: a clear must never reset it (an old generation would validate again).
- `CacheRedis.clear()` bumps BEFORE removing: a CAS that slipped in before the bump is removed with the rest, any CAS after it is refused.
- `CacheMulti.setUnlessCleared`: Redis decides for every process; the local copy is skipped when the local `clearGeneration` moved during the CAS (a peer's clear message came after Redis kept it).
- `CacheLocal` keeps the generation in process (local-only config).
- `getWithGeneration(k)` replaced `readGeneration()` (#752 autoreview, choice A): a miss reads value + generation in ONE MGET; `CacheMulti` answers a local hit with no Redis call and refills local only if no clear crossed the read.
- Only the permissions cache uses `@directus/memory` Cache (schema/response are Keyv, keys `ns<suffix>::*`, never matching `ns:permissions-generation`).
- Redis Cluster CROSSSLOT: moot, the fork has no Cluster support.
- `allkeys-*` eviction can drop the generation key (no TTL): a read holding 0 then stores across a clear. Disclosed, not fixed.
- Blackbox: `tests/blackbox/tests/db/routes/permissions/permission-delete-read.feature`.

Related: [[reference_directus_withcache_inflight_dedupe]], [[project_directus_cache_failure_semantics]].
