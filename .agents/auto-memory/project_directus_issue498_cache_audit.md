---
name: directus_issue498_cache_audit
description: Issue #498 cache audit (replay every live entry against the database) — settled design points, history tables + live schedule + MCP group + cache-page panel (PR #499), the traps each surface hit, the two defects only a hand-run smoke caught
metadata:
  author: Jean Claveau
  type: project
---

Issue jclaveau/directus#498 on branch `v11.10.1-feat/cache-audit`, based on
`v11.10.1-hhh-dev` at 0fc1af2a66. Surfaces: `POST /utils/cache/audit` (admin),
`directus cache audit [--json] [--purge] [--strict] [--limit N] [--user] [--collection]`
(exit 0 clean / 1 stale or drifted / 2 unreplayable under `--strict`), cron
`CACHE_AUDIT_SCHEDULE`, ignore globs `CACHE_AUDIT_IGNORE_PATHS`. Verdicts:
`fresh | stale | tag_drift | raced | time_varying | expired | unreplayable:<reason>`.

**Settled deviations from the issue text (don't re-raise):**
- Replay marker is an HMAC header `x-cache-audit-replay` (secret-derived), not
  `Cache-Control: no-store` + `CACHE_SKIP_ALLOWED` — the latter would let any
  client bypass the cache. `cache.ts` skips read+fill on it; `respond.ts` answers
  the derived tags in `x-cache-audit-tags` and records no stats.
- `CACHE_AUDIT_SCHEDULE` is a cron, not an interval (every other schedule is).
- A replay 403 is `stale` (`reason: replay_status_403`), not unreplayable: the user
  would be served a 403 today instead of the entry.
- The replay JWT carries `app_access: false, admin_access: false` — `verifyAccessJWT`
  REQUIRES those claims present and recomputes both from the DB anyway.
- `purge: true` evicts per entry (`evictCacheEntry(redisKey)`), only stale/tag_drift.
- History: `directus_cache_audits` (row per run, column per verdict, `trigger`
  rest|cli|cron|mcp) + `directus_cache_audit_findings` (cascade); every surface
  goes through `runCacheAudit` in `cache-audit-runs.ts`; `CACHE_AUDIT_RETENTION`
  30d; `GET /utils/cache/audits[/:id]`. Live schedule: `directus_settings.
  cache_audit_schedule` overrides env, `settings.update` action → bus
  `cacheAuditScheduleChanged` → every node reschedules; `GET/PATCH
  /utils/cache/audit/schedule`. MCP group `cache_audit` (own group, like
  `autoscale_drill`, so an agent with `cache` reads doesn't get a run). Cache
  page: `cache-audit-panel.vue` under the anomaly summary.

**Traps hit wiring the history/GUI/MCP (PR #499):**
- The `/utils/cache/anomalies` listing is the top 200 groups BY COUNT over a
  shard-shared table: a fresh count-1 row falls off under load (the shard-5
  "flake"). A bb wait must read `directus_cache_stats_anomalies` joined to
  `_descriptors` directly — AND match path+query, since every earlier case's
  anomaly on the same path is still in the table.
- The three audit bb suites share `directus_settings` and the bus: a schedule
  one PATCHes reschedules every instance in the shard → sequential chain.
- `validateCron` (cron-parser) is lenient: `* * *` and 6 fields are VALID;
  `hourly`, `60 * * * *`, 7 fields are not.
- A finding's `redis_key` is the BARE digest (Keyv's iterator strips both the
  `@keyv/redis` `<ns>_response::` and Keyv's `<ns>_response:` prefixes): no
  namespace to `like` on. Tell two nodes' cron findings apart by `url` +
  `started_at`, never by key prefix (shard-5 failure on d8ffef1815/7f9f381302).
- The cron is CLUSTER-WIDE (`scheduleSynchronizedJob` + shared settings rule):
  api nodes win ticks too. Per-node opt-out = `CACHE_AUDIT_ENABLED=false`
  (default true; jean chose one master switch over a schedule-only one): no
  job, REST audit routes 404 (`RouteNotFoundError`, like an unmounted
  `/system-mcp`), `cache_audit` MCP group dropped, CLI refuses before boot,
  `runCacheAudit` throws 503 as the last net; the node still relays a settings
  write over the bus. Prod: bo on, api services off. Still no overlap guard,
  no wall cap, REST/MCP run synchronous (proxy timeout on prod size).
- `system-mcp.test.ts` pins the exact tool list and all-readOnly → a group
  with acting tools needs its own bb instance (`SYSTEM_MCP_TOOLS=cache,cache_audit`).
- App: `formatDuration` takes SECONDS; `v-table` default cells render
  `v-text-overflow` (unregistered in tests → empty) and treat `0` as null →
  explicit `#item.x` slots; a hyphenated SFC-imported child DOES mount in the
  parent's test → `stubs`; `vi.useFakeTimers({ toFake: ['Date'] })` or
  knex-mock-client freezes.

**Defects only the hand-run smoke caught (unit + bb suites were green):**
1. The CLI boot answered its own loopback replays `503 Under pressure`:
   `PRESSURE_LIMITER_ENABLED` defaults true and the event loop that just booted
   samples saturated for the first 250ms windows. `cli/run.ts` now disables it for
   `cache audit` next to `CACHE_AUTO_FLUSH_ON_DEPLOY=false`. A live node under
   real pressure still yields `unreplayable:status_503` — honest, retry next tick.
2. A `no_descriptor` finding rendered `user public` — unknown ≠ public; `-` now.

**Blackbox witnesses beyond the obvious (both smoke-proven first):**
- `raced`: a read hook that WRITES (`cache-audit-race` extension) — armed by a
  flag row, the replay's own read moves the row through `services.ItemsService`
  (purging the entry) and answers the moved value → diff over a gone entry.
- `replay_status_403` → stale: revoke the permission by a RAW rename of its
  `collection` (a permission written through the API flushes the response cache
  along) then `POST /utils/cache/clear?targets=system` — targets are read off
  the QUERY STRING, a JSON body silently defaults to `response`. The cache still
  serves the rows to the revoked user (HIT), the replay answers 403.
- Anomaly rows are one per reason+cacheKey and the listing carries no user, so
  two users' entries on one path are told apart by `sample`; `path` there is
  the pathname, `url` carries the query.
- Not bb-reachable, unit-only: `expired` (Redis TTL = sidecar TTL), non-403
  replay statuses, `replay_unrecognized`, `unreadable`, the `document/method/
  query` plan reasons, and a non-empty `purgesSinceFilled`.

**Why:** the audit replays through the same process that serves it, so every
boot-time or load-time guard of the API (pressure limiter, deploy flush) turns
into a self-inflicted audit failure; a bb suite warms the loop before auditing and
never sees it.

**How to apply:** for any future self-replaying job in the CLI, gate the API's
self-protection in `cli/run.ts` before `createCli()`, and always smoke the built
CLI once by hand (`curl -g` for `[`/`]` in URLs) — see
[[project_directus_blackbox_cache_local_repro]] for the redis+sqlite hand-run
recipe and [[reference_directus_useenv_mock_hoisted]] for the env mock pattern.

**PR #499 CI-green, NOT merged yet** (waiting on explicit "merge it" — do not
merge without it): history tables, live schedule, MCP group, cache-page panel,
`CACHE_AUDIT_ENABLED` per-node switch — all landed and green (postgres shards,
unit, acceptance/Playwright, CodeQL) as of head `ef1588fd73`.

**Descriptor-driven queue (2026-09-16, replaces the Redis SCAN loop):**
- Prod measured (read-only, `--scan --count 10000` + `comm` against
  `select redis_key from directus_cache_stats_descriptors`): **47,833 live
  response bodies, 0 without a descriptor**; 407k descriptors of which 88%
  describe an entry already purged (kept by the events reference); keyspace
  1.04M = 639k `scalabus:stats:tomb:*` + 144k `permissions:*` + 68k `rlflx`.
  The 08-26 "270k keys" was TOTAL keys, not entries. Full-run cost ≈ 47.8k ×
  replay latency / 4.
- Engine: `readCacheAuditQueue(count, before, {user, collection})` pages
  `directus_cache_stats_descriptors` `WHERE last_filled NOT NULL AND redis_key
  <> '' AND (audited_at IS NULL OR audited_at < before) ORDER BY audited_at
  NULLS FIRST, last_filled LIMIT 500`; `cache.getMany` for bodies; gone rows
  passed over; `advanceCacheAuditQueue(cacheKeys, now)` stamps passed + examined
  BEFORE the replay (claim); `before` = run start EXACTLY (a 1 s grace broke
  back-to-back runs: the second skipped what the first stamped) so the column
  is `timestamp(3)` (MySQL seconds would sort a stamp before its own run's
  start → re-read loop). PG index `(audited_at NULLS FIRST, last_filled)` raw;
  plain index elsewhere. `limit` = live entries examined; excess live rows of
  the last page stay unstamped for the next run.
- `CACHE_AUDIT_LIMIT` (number, default 0 = whole queue) is the default `limit`
  for any run that names none, applied in `runCacheAudit` (recorded in the run
  options): the cron's chunk knob AND what keeps "Audit now" bounded on prod.
- `unreplayable:no_descriptor` is GONE (an undescribed entry is not in the
  queue); `CacheAuditFinding.cacheKey/method/url/query/filledAt/ageMs` are no
  longer nullable (api, app panel type, spec, finding columns notNullable);
  stats off → `auditCache` throws "CACHE_STATS_ENABLED is off".
- bb: `settled(warmed)` waits for `scanned >= warmed` (the old no_descriptor
  signal no longer exists); `--strict` witness is now `user_gone` (raw
  `directus_users` delete of a throwaway admin user, leaves the cache alone);
  REST suite witnesses resume order via `audited_at` stamps: acme, globex, acme.
- Still open: no overlap guard beyond the queue's own partitioning (two
  concurrent runs share the queue rather than double-replay), no wall cap;
  REST/MCP run synchronous.
