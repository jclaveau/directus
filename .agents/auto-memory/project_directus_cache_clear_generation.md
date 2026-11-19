---
name: project_directus_cache_clear_generation
description: "@directus/memory clear generation (#751): `${ns}-generation` Redis key, bumped BEFORE the key removal, setUnlessCleared Lua CAS; withCache stores and shares only a read no clear crossed"
metadata:
  type: project
---

A read that runs across a `clear()` must neither be stored nor be shared with the callers joined on it (#751, PR from branch `v11.10.1-fix/permissions-cache-generation`).

```
t0 read: gen = readGeneration()        -> 4
t1 clear: INCR ns-generation (5), UNLINK ns:*
t2 read: setUnlessCleared(k, v, 4)     -> false, nothing stored, joiners re-read
```

- Key `${namespace}-generation` sits OUTSIDE the `${namespace}:*` pattern `KvRedis.clear()` SCANs: a clear must never reset it (an old generation would validate again).
- `CacheRedis.clear()` bumps BEFORE removing: a CAS that slipped in before the bump is removed with the rest, any CAS after it is refused.
- `CacheMulti.setUnlessCleared`: Redis decides for every process; the local copy is skipped when the local `clearGeneration` moved during the CAS (a peer's clear message came after Redis kept it).
- `CacheLocal` keeps the generation in process (local-only config).
- Every `CacheRedis`/`CacheMulti` user's `clear()` now also INCRs that key: one extra key per namespace.
- Redis Cluster: the generation key and the cache key may hash to different slots, so the Lua script would fail with CROSSSLOT. Open question on the PR.

Related: [[reference_directus_withcache_inflight_dedupe]], [[project_directus_cache_failure_semantics]].
