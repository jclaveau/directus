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

**Verified-at ordering (2026-09-16, replaces `audited_at NULLS FIRST`):**
- A fill IS a verification (it reads the DB), so the queue orders on
  `verified = max(audited_at, last_filled)`: `CACHE_ENTRY_VERIFIED_AT` in
  `api/src/utils/cache-entry-verified-at.ts` is a `CASE WHEN audited_at IS
  NULL OR audited_at < last_filled THEN last_filled ELSE audited_at END` —
  CASE not GREATEST (MySQL/SQLite GREATEST is null-poisoned) and ONE spelling
  shared by the query and the PG expression index `((expr), last_filled)`
  (the planner matches on text). Queue: `WHERE verified < before ORDER BY
  verified, last_filled`; a row refilled during the run falls out on its own.
- Horizon = `MIN(verified)` over queued rows + `neverAudited` (SUM audited_at
  IS NULL); dead descriptors (entry already purged) are counted along —
  accepted. Surfaces: `GET /utils/cache/audit/queue` `{size, neverAudited,
  verifiedSince}`, MCP `read_cache_audit_queue`, panel "horizon" line; entry
  listing/read/MCP carry `auditedAt` + `verifiedAt`, cache page sorts/shows
  "Verified" `(audit)`/`(fill)`.
- Drain lag trap: descriptors land on the 1 s `CACHE_STATS_DRAIN_SCHEDULE`, a
  refill on the same key keeps the old `last_filled` until then → a bb witness
  of "refilled row drops behind" must poll `last_filled >= refill time` first.

**Run answer, retire, time budget, in-flight claim (2026-09-17, heads
23b00f76 → fe7f6e90 → f7c35c99):**
- Page/tags split (6db34d33): bodies and tags are fetched only for the
  entries a page will examine, gated on EXISTS; the expiry sidecar is read
  ONCE per page.
- A run answers as the history records it (`runOf(row)`), findings are
  paged from `directus_cache_audit_findings` (`GET /utils/cache/audits/:id/
  findings`); the report is no longer the in-memory object.
- `gone_at` (timestamp(3), descriptors): the audit stamps it when
  `cache.hasMany` says the entry is not held (`retireCacheAuditQueue(keys,
  askedAt)` guarded `last_filled <= askedAt`); every fill writes `gone_at:
  null` through the descriptor merge; queue + horizon filter `gone_at IS
  NULL`; PG index is partial on it. Descriptors are KEPT (the stats
  dimension; the reaper handles orphans) — retire only takes them out of the
  walk. Consequence: `cache_key` is namespace-agnostic, so two
  `CACHE_NAMESPACE`s on one DB is UNSUPPORTED (a node retires what it cannot
  hold) — the CLI bb rig had exactly that and lost six cases on fe7f6e90;
  the scheduled node now shares the namespace and spawns last (f7c35c99).
  The three audit suites are already serialised in `sequential-tests.ts`,
  so no cross-file retire.
- `CACHE_AUDIT_MAX_DURATION` ('10m', TYPE_MAP string, ≤0 → default) checked
  AFTER each page → `timedOut` on report/row (`timed_out`)/MCP/spec/panel/
  CLI ("stopped on CACHE_AUDIT_MAX_DURATION; the next run resumes behind it").
- One run at a time: `getCache().lockCache` key `cache-audit:run` (value
  `Date.now()`, TTL budget+60 s), second ask → `ServiceUnavailableError` 503
  "a cache audit is already running, since <iso>"; read-then-write, not
  atomic (documented); released in `finally`; lock lives in the
  `<ns>_lock` Keyv so it is per namespace.
- MCP: a Joi refusal inside a tool answers JSON-RPC `-32602` (handle-request
  .ts), NOT `isError` — assert `body.error.code`.
- bb env-inject extension: `POST /env-inject/set {key, value}` on a spawned
  instance mutates its `useEnv()` object (used for the 1 ms budget witness;
  restore in `finally`).
- Typecheck: `npx tsc -p api --noEmit` gets SIGTERM'd when the box's swap is
  full → `~/.local/share/pnpm/tsgo -p api --noEmit` (rc 0) is the fallback.
- Still open (jean's call / PR body disclosure): #4 diff CPU on the event
  loop, #6 horizon full scan, #7 rate limiter ignores the replay marker,
  #9 `jwt.sign` per entry. PR body update pending (never right after a push).

## 2026-09-17 review round (60d47113) — what changed, what is parked

- A Keyv `hasMany` over an unreachable store answers `[false × n]` and emits
  `error` on the store (Keyv re-emits, `emitErrors` default true) → the
  audit read a whole page as gone and RETIRED it. `askHeld()` listens on
  `cache.on('error')` around the ask and throws "The cache could not be
  asked what it holds: …" → run fails, nothing stamped. bb witness: a
  second REST node behind `createRedisProxy` (now `tests/blackbox/common/
  redis-proxy.ts`, shared with the outage suite), same namespace, nested
  describe LAST.
- Expiry sidecar read in the page's `getMany` (`[key, key__expires_at]`
  pairs), decompressed in `snapshot()`; a refill between page read and
  replay is now `refilled`→re-judged, not `held`→stale.
- Run lock: `RUN_LOCK_TTL_MS` 120 s renewed every 30 s (`setInterval`
  `.unref()`), not budget+60 s. Reap moved from `finishCacheAuditRun` to
  `runCacheAudit`'s `finally` (runs on the fail path too) and now also
  closes orphans (`finished_at IS NULL AND started_at < now − 2·budget − 1 h`,
  error "The run did not finish: its process died"). A failing
  `finishCacheAuditRun` is recorded via `failCacheAuditRun` (knex prefixes
  the SQL to the message → assert `stringContaining`).
- `isCacheAuditInFlight(err)` exported; the schedule logs a 503 tick as
  `info` "tick skipped: …", not warn.
- REST + MCP validate with `{ allowUnknown: true, stripUnknown: true }` —
  `maxDurationMs`/`replay` in a body are DROPPED (were a 400). CLI refuses
  `--limit` not a whole number ≥ 1 before boot (exit 1).
- `directus_cache_audit_findings.redis_key` is `text` (readable keys under
  `CACHE_KEY_HASH_ENABLED=false` exceed 255); the CLI bb scheduled node runs
  with hash off and a 61-owner `_in` filter as witness.
- PARKED as #500: replay ignores language / negotiated content type /
  `CACHE_VARY_REQUEST_HEADERS` / ip key dimensions → false `stale` on such
  deployments; proposed `vary` JSON on the descriptor + replay headers +
  `unreplayable:ip`.
- Disclosures still owed in the PR body: `/utils/cache/clear` `locks`
  target drops the run claim; `DIFF_PATHS_COMPARED` 500 bound hides a real
  diff past 500 ignored pointers; memory store under a PM2 cluster is a
  cache per worker (unsupported topology); #500.
- bb typecheck now shows ~280 pre-existing errors (main-tree node_modules
  drift) — grep the touched files only.

## 2026-09-17 continued (0eb52062 → 17eedfdf: renewal race, PR body, the outage case's real blocker)

- Cold re-review found one more race: releasing the run lock in `finally`
  could fire before a pending renewal `setInterval` tick finished writing —
  `0eb52062` awaits the renewal's in-flight write before `lockCache.delete`.
  Witness red without the fix, green with it.
- PR #499 body rewritten (16 KB) with the full design + every round's
  disclosures. A body edit fires GitHub's `edited` event, which cancels the
  in-flight preview tunnel — re-dispatch `preview-admin.yml` after.
- The outage bb case (shard 6, "a node whose cache went away") went red six
  rounds: the cut-off node (Redis behind `createRedisProxy`, cut mid-test)
  answered 500 `MaxRetriesPerRequestError` on ANY request before the audit
  was asked. Two per-node lookups on the request path go through a client
  that raises (#366 "surviving ≠ answering"):
  1. `getSchema` — the in-process schema cache is nulled by any node's
     `schemaChanged` bus message (sibling suites churn schema constantly) and
     rebuilt behind `useLock().increment` (ioredis). `CACHE_SCHEMA=false` on
     the cut-off node reads schema from the DB per request.
  2. permissions — `CacheMulti` (`packages/memory/src/cache/lib/multi.ts`):
     `set`/`delete` publish `{type:'clear', key}` on the bus with the FIXED
     namespace `permissions` (not CACHE_NAMESPACE-scoped), so every process
     on the same Redis drops its local copy of that key. `withCache` keys are
     `namespace-hash(args)` and identical for the admin across nodes → the
     45 bb suites on redis 6108 keep dropping a node's warm admin keys; the
     next lookup on the cut-off node is cold → ioredis → 500. Priming reads
     and priming audits cannot keep them warm.
  Fix = a bb hook extension `tests/blackbox/extensions/cache-audit-identity`
  (`authenticate` filter: header `x-cache-audit-identity` = user token,
  looked up in `directus_users`, returns an admin accountability; the
  middleware short-circuits on a changed accountability so no cache is
  touched on the way to the audit). Enabled per node by
  `CACHE_AUDIT_IDENTITY_TOKEN` env. Same shape as the api-guard hook.
- An "anonymous read first" probe was invalid, not refuting: the cache-key
  builder calls `fetchPoliciesIpAccess` per accountability, and the public
  one had never been looked up on that node → its own cold key
  ([[feedback_failed_probe_may_be_invalid_not_refuting]]).
- The CLI as an alternative rig was rejected: boot-time ioredis awaits with
  the proxy cut never return.
- `askHeld` message was empty for node-redis's `AggregateError` (message
  `''`): now described by the last attempt's message / the error name.
- Two flake classes seen on this branch's shards, NOT this PR:
  - shard 4 `cache-cascade-delete.test.ts` "Field parent doesn't exist" +
    `reading 'kill'` = stale-schema race (`schemaCache--done` bus message
    carries another node's stale schema) against concurrent schema-crud
    suites; rerun green every time — `gh run rerun <id> --failed`.
  - the schedule case (`takes a schedule live off the settings`) once:
    `cacheAuditScheduleChanged` reaches every node on the shared bus (foreign
    suites' nodes, other CACHE_NAMESPACE) → the synchronized tick can be won
    by a node that can't hold the entry → descriptor retired. A failed run
    of the case leaves `* * * * * *` in settings → later-booted nodes run a
    per-second cron. Hardening candidate if it recurs.
- Still NOT merged; do not merge without an explicit "merge it".

