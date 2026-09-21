---
name: project_directus_cache_envelope_520
description: Issue #520 fix on v11.10.1-perf/cache-envelope — fork Keyv envelope (`{"envelope":2,…}`, base64 for the one Buffer) replaces @keyv/serialize, jsonpack dropped under snappy, fill timer stops after the SET; the "336 ms SET" in the issue was a degraded container, not Redis; legacy-read window + bench numbers + settled points
metadata:
  author: Jean Claveau
  type: project
---

Branch `v11.10.1-perf/cache-envelope` off `origin/v11.10.1-hhh-dev` (2026-09-21),
addresses #520 (large-entry HIT/MISS cost sits in the Keyv envelope, not Redis).

**What landed**
- `api/src/utils/cache-envelope.ts`: `serializeCacheEnvelope`/`deserializeCacheEnvelope`
  wired into every tier via `getConfig` in `cache.ts`. Document = `{"envelope":2,`
  + `value` (plain JSON) or `base64` (the ONE Buffer a tier ever gets: the whole
  snappy payload from `compress.ts`) + `expires`. Head sniffed on the first bytes;
  anything else goes through an inlined copy of `@keyv/serialize@1`'s reviver
  (`:base64:` → Buffer, one leading `:` stripped) for the deploy window.
- `compress.ts`: snappy over `JSON.stringify` (jsonpack gone); `decompress` tries
  `JSON.parse`, falls back to `@directus/utils` `decompress` — a jsonpack string can
  never parse as JSON (starts with the token dictionary `data|…^…^…^…`).
- `respond.ts`: `filledAt = Date.now()` AFTER `Promise.all([setCacheValue, sidecar])`;
  `fillMs` = `filledAt - requestStart` ("request entry → entry written"). Writes stay
  BEFORE `res.json` — deferring would race the in-flight-purge guard's eviction and
  the MISS→HIT ordering bb suites rely on.
- bb: `tests/blackbox/common/redis-proxy.ts` gained `delaySets(ms)` (order-preserving
  per-connection chunk queue; delays any client chunk containing `$3\r\nSET\r\n`, the
  node-redis uppercase spelling — ioredis sends lowercase `set`, so the tombstone
  write is untouched). Spec `cache-entry-envelope.test.ts`: two spawned instances
  (snappy through the proxy + stats; `CACHE_COMPRESSION_ENABLED=false` direct), raw
  ioredis reads of the entry + `__expires_at` sidecar, legacy entries hand-written
  at the live key, `fill_ms >= 400` polled on `directus_cache_stats_descriptors`.
- Dev deps added: `@keyv/serialize` (api, the legacy oracle in the unit test) and
  `snappy` (tests/blackbox); both already in the lockfile graph.

**Measured (bb redis 6108, synthetic 1.48 MB nested payload, median of 7)**
old jsonpack+@keyv/serialize: fill 160 ms (pack 148 + set 9), hit 91 ms (get 4 +
unpack 87), stored 1.21 MB. new: fill 22 ms (pack 15 + set 5), hit 16 ms (get 2 +
unpack 14), stored 654 KB. Earlier baseline on the UNCOMPRESSED nested value:
`defaultDeserialize` 103–148 ms vs `JSON.parse` 8.5–11.5 ms.

**The issue's "local Redis 6.2 ingests a 1.4 MB SET in ~336 ms" was WRONG**: the
5-day-old `blackbox-redis-1` container did 500 ms p50 (~2.8 MB/s linear) but a
fresh redis:7 = 1.4 ms, redis:6 = 3.7 ms, and `docker restart blackbox-redis-1`
→ 2.1 ms. Container degradation, not Redis. Restart the bb redis before any
SET-cost measurement.

**Settled, don't re-raise**: writes before `res.json` (guard soundness); a nested
Buffer inside a value goes through `toJSON` (`{type:'Buffer',data}`) — same as
`res.json` would send; no `@keyv/serialize` runtime dep (reviver inlined);
`CACHE_AUTO_FLUSH_ON_DEPLOY` is what actually drops legacy entries in prod.

**Follow-ups noted, out of scope**: 3× `JSON.stringify` of the payload per MISS
(CACHE_VALUE_MAX_SIZE gate, compress, res.json); planner-side field narrowing.

Related: [[project_directus_big_entry_hit_cost]], [[project_directus_keyv_raw_key_shape]],
[[project_directus_blackbox_spawn_own_instance]], [[reference_directus_blackbox_supertest_query_encoding]].
