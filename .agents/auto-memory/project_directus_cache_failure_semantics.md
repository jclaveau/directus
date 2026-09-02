---
name: project_directus_cache_failure_semantics
description: The four cache layers in one Directus call path fail differently — ioredis raises, Keyv swallows, the bus is fire-and-forget, @directus/memory raises — so "Redis is down" produces a different symptom per layer
metadata:
  type: project
---

One flush/purge path touches four stores with **four different error semantics**. This
is why reading the code yields plausible-but-wrong causes (I named three wrong ones for
a single 500 on 2026-08-24 before instrumenting).

- **ioredis** (`useRedis()`, tag SETs, `smembers`/`del`/`srem`) — **raises**
  (`MaxRetriesPerRequestError` after ~20 attempts). The loud half.
- **Keyv** (response/system/lock caches) — **swallows**. `clear/get/set/delete` catch
  store errors, emit `error`, and answer `undefined`; `_throwOnErrors` defaults to
  `false` and Directus never sets it. A failed delete is indistinguishable from a
  successful one at the call site.
- **The bus** (`useBus()` → `@directus/memory` redis bus) — **fire-and-forget**.
  `clearSystemCache` does NOT await `messenger.publish('schemaChanged', …)`, so a
  rejection becomes an unhandled rejection the process listener logs. Never a 500.
- **`@directus/memory` multi cache** (permission cache, `clearPermissionCache()`) —
  **raises**, and `clearSystemCache` awaits it. This one, not the tag index and not the
  bus, is what made a schema apply answer 500 during an outage.

**Consequences already load-bearing:**

- The pending-purge table only ever records what **ioredis** raised. `mode:'namespace'`
  calls only `cache.clear()` (Keyv), so it cannot be recorded in production — its unit
  test passes only against a mocked rejection real Keyv never produces.
- A drain cannot ask a flag whether the entry store works; it must round-trip a write
  ([[project_directus_purge_recovery_bare_tag]]).
- `flushCaches` treats the system-cache clear as best-effort; `clearCacheTargets` keeps
  throwing, because there an operator asked for the clear.

**How to apply:** before theorising about a cache failure, name WHICH store the failing
call belongs to and look up its semantics here. Then instrument — the response body and
the instance log name the throwing call; code-reading does not.
