---
name: project_directus_deployment_namespace_bus_lock
description: PR #503 — bus and lock follow CACHE_NAMESPACE; get-schema couples them (lock split must be ≥ bus split); MONITOR-based bb witness; sync namespace left alone on purpose
metadata:
  author: Jean Claveau
  type: project
---

PR #503, MERGED 2026-09-17 as `da0d3fb188`: `useBus` names the Redis bus `<CACHE_NAMESPACE>:bus`
(`BUS_NAMESPACE` overrides) and `useLock` names the lock kv `<CACHE_NAMESPACE>:lock`.
Before, both were fixed `directus:*` — every deployment on one Redis heard every
other's channels (settings, flushes, processes report incl. the env dump, drills)
and shared every lock.

**Why the lock had to follow the bus:** `api/src/utils/get-schema.ts` takes
`schemaCache--preparing` then, when another node holds it, waits for
`schemaCache--done` on the bus. A lock shared wider than the bus leaves the waiter
listening for a message published where it cannot hear it → one node builds per
`CACHE_SCHEMA_SYNC_TIMEOUT` (10 s) round, `MAX_ATTEMPTS=3` then boot crashes. Seen
live in CI at dd6e47f6: `cache.test.ts` hook-timed-out at 180 s once the hints put
`cache-config-broadcast`'s three Redis nodes beside its own. Invariant: lock split ≥
bus split; a lock split finer than a shared bus only has both sides build.

**Left alone:** `SYNCHRONIZATION_NAMESPACE` (default `directus-sync`) — not bus
coupled, prod runs `SYNCHRONIZATION_STORE=redis`, moving the key would run every
synchronized job (cache-stats drain every 10 s) on both sides of a deploy overlap.

**Witnessing a lock that lives milliseconds:** `deployment-namespace.test.ts` puts an
ioredis `monitor()` client on the shared 6108, drops a node's schema with
`POST /utils/cache/clear?targets=system`, polls `GET /collections` and matches the
whole `PUBLISH` channel / `INCRBY` key — other suites' traffic can only add lines.

**Rollover risks (first consumer deploy carrying it):** old workers on `directus:bus`
miss a migration's `schemaChanged` (`flushCaches` in `migrations/run.ts`) and keep
their pre-migration in-memory schema until replaced — ship in a deploy without a
schema migration or accept the window. Later deploys have both sides on `scalabus:bus`.

**bb residue:** autoscaler suites that name no namespace still share `scalabus:bus`
+ the vendor's `directus_settings` row; a Directus naming its own `CACHE_NAMESPACE`
must hand it to its autoscaler (`startAutoscaler(rig, { CACHE_NAMESPACE })`).
`cache-cascade-delete` "Field parent doesn't exist" = the shared cache instance's
stale-snapshot flake (`common/config.ts:331`), not a namespace issue.
