---
name: project_directus_cache_redis_db_559
description: CACHE_REDIS_DB (PRs #572/#577, issue #559) — response cache in its own Redis DB flushed by FLUSHDB; settled design B, guards, MULTI epoch reseed, COUNT 1000, Valkey CI, one-namespace-per-DB, planner prod facts; do not re-raise
metadata:
  author: Jean Claveau
  type: project
---

`CACHE_REDIS_DB=<n>` moves the `_response` Keyv tier + scoped-cache index sets + epoch
counters into their own Redis DB; a flush is one `FLUSHDB ASYNC` instead of a namespaced
SCAN over the whole keyspace (prod: 4 boot flushes of 95–201 s overran the 600 s
healthcheck). MERGED: #577 (flush bench, `72784ad2e8`), #572 (`1225982ed1`), closes #559.

**Settled (do NOT re-raise):**
- **Design B**: only response + index + epochs move. `_system`, `_lock`, permission cache,
  bus, stats stay in db0. A response clear must be a FLUSHDB of a DB holding nothing to
  keep — a namespaced SCAN inside the cache DB walks the same ~270k keys (jean caught my
  "option A" here). System/permission in their own third DB only if prod `INFO keyspace`
  shows a big db0 after the switch.
- Old db0 cache keys are flushed BY HAND at the switch; no migration/code path.
- The shared-DB guard reads the DB the way BOTH clients do: ioredis = path → `?db=` → 0;
  node-redis (@keyv/redis) = path only. Refuse a `CACHE_REDIS_DB` equal to either, a
  scheme-less `host:port`, a unix socket, non-integer. Ignored with a warn.
- FLUSHDB runs in a MULTI with a fresh `*` epoch bump queued after it (FLUSHDB deletes the
  counter it just moved → a fill that read `*` null rechecks null → keeps a stale row).
  Three outcomes: `not-flushed` (EXECABORT, fall back to `cache.clear()`), `flushed`,
  `flushed-queued-command-failed` (OOM → bump once more; a one-round-trip window remains,
  documented). No blackbox witness: `dropScopedCacheIndex`'s later bump would mask it.
- **One `CACHE_NAMESPACE` per cache DB** (a FLUSHDB empties other namespaces' counters
  too). Planner prod is safe: each Railway env has its own Redis service, Api+Backend share
  the default namespace, URL has no path (shared DB 0), FLUSHDB not renamed. Option (b)
  claim-key enforcement REJECTED as out of scope.
- `KvRedis.clear()` (`@directus/memory`) now scans `count: 1000`; ioredis `scanStream`
  defaults to 10 → ~100× the round trips. Measured: shared arm 276→2039 SCANs for
  2k→20k keys (198→599 ms); own-db flat 73 (167→163 ms).
- Fork CI + local compose moved from `redis:7-alpine` to `valkey/valkey:9.1.2-alpine`
  (prod runs Valkey 9.1.2); image ships `redis-cli` symlink. Kept in #572 by jean's call.
- Blackbox races fixed by moving to the serial `after` list in `setup/sequential-tests.ts`:
  `cache-config-broadcast` (writes `cache_ttl`, every booting instance takes it) and
  `users/cache-nested-relation-tags` (drops a `directus_users` alias; an instance on its
  own namespace never hears `schemaChanged` since #503 → `POST /users` 500 42P01).
- Bench `cache-flush.perf.test.ts` gates SCANs *added by growth* on own-db ≤ 2, sanity
  floor shared ≥ 9; ms reported not gated; grows the cache with synthetic Keyv-shaped keys
  in whichever DB the build actually uses (detected from real filled entries).

**How to apply:** planner side (`CACHE_REDIS_DB=1` in `.env` files, never a Railway var;
collapse `init.sh`'s 4 flushes) was handed to session cache-fingerprints-72 / planner PR
#795. Follow-up bugs: [[project_directus_cache_flush_offline_tiers_581]]. Bench context:
[[project_directus_cache_bench_gates_560]].
