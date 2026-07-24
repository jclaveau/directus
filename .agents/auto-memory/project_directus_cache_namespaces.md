---
name: project_directus_cache_namespaces
description: PR #225 — cache namespace root renamed system-cache→scalabus (the fork's new name), each Keyv layer suffixed _response/_system/_schema/_lock; scoped purge is transparent to the _response split
metadata:
  type: project
---

PR **#225** (MERGED into v11.10.1-hhh-dev). **`scalabus` = the fork's new name** (jclaveau/directus →
Scalabus); it became the `CACHE_NAMESPACE` default.

**Layers** (`api/src/cache.ts` `getCache()`), root = `CACHE_NAMESPACE` (default `scalabus`):
- `scalabus_response` — the API/HTTP response cache (was the **bare root** `system-cache`, the confusing part).
- `scalabus_system` — schema / permissions / getSchema (`_system`, unchanged — accurate once root isn't "system").
- `scalabus_schema` — local in-memory schema mirror. `scalabus_lock` — locks.
- `scalabus:tag:*` — the scoped-cache tag index (a raw-Redis key, NOT a Keyv namespace).

**Why the rename:** `system-cache` collided 3 ways with **system collections** (`directus_*`), and the
bare-root instance under it was the response cache — nothing system. Root → `scalabus`; response layer named
by payload `_response` (jean: "_data is meaningless"). Kept `_system` + the `getSystemCache` fn names
(out of scope). See [[feedback_disambiguate_colliding_names]].

**Scoped purge is transparent to the `_response` split** (load-bearing, non-obvious): tag keys are built off
the ROOT (`${CACHE_NAMESPACE}:tag:`, `scoped-cache.ts:105/222`), and members are deleted via
`cache.delete(member)` — Keyv adds the `_response` prefix internally on both `set` and `delete`. No raw SCAN
targets the response namespace. So moving the response cache off the bare root needed NO change in
scoped-cache.ts. Verified by reading 105/222/226.

**`CACHE_STORE` typing:** `env['CACHE_STORE']` is `unknown` (Env = `Record<string,unknown>`; TYPE_MAP is
runtime-coercion only — [[project_directus_env_type_map]]). Narrowed once at the boundary:
`const store: Store = env['CACHE_STORE'] === 'redis' ? 'redis' : 'memory'`; `getKeyvInstance(store: Store)`
stays typed (no `as`, no `unknown` param — [[feedback_ts_as_cast_smell]]).

**`flushCaches()` leaves `scalabus:tag:*` orphaned** (opposite of scoped-purge's transparency above): a namespace `cache.clear()` scans only `scalabus_response:*`, never the raw-redis tag SET keys (`sadd`, outside Keyv) — they self-expire via `ttl*2`. A clean full-flush must ALSO `SCAN + DEL scalabus:tag:*`. See [[project_directus_issue295_cache_ttl_flush]].

Related: [[project_directus_schema_read_cache_tagging]], [[project_directus_scoped_cache_design]], [[project_directus_issue295_cache_ttl_flush]].
