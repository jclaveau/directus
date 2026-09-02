---
name: project_directus_redis_outage_kills_process
description: An unreachable Redis exits the Directus API process — five independent unhandled emitters/rejections found in v11.10.1, all upstream-shaped, each fixed on the pk-pin branch
metadata:
  type: project
---

Found 2026-08-18 while blackbox-testing #365 (cut Redis with a TCP proxy, expect the
write to answer 200). The instance did not answer 500 — it **exited**. Five separate
paths, each independently able to kill a process that was serving requests fine:

1. **The shared ioredis client** (`redis/lib/create-redis.ts`) — no `error` listener
   on the client, none at any of the 24 `useRedis()` call sites. ioredis emits one
   per failed reconnect; an unhandled `'error'` event rethrows.
2. **`BusRedis.sub`** (`packages/memory/src/bus/lib/redis.ts`) — built with
   `config.redis.duplicate()`, which copies the options and **none of the
   listeners**, so the handler on the shared client never reached it. Only
   `.duplicate()` in the tree.
3. **The four Keyv store clients** (`cache.ts` `getConfig`) — `@keyv/redis` v5 is
   node-redis based and wraps its own client; Keyv does **not** re-emit that
   client's `error` events, so `cache.on('error')` on each Keyv instance only ever
   saw errors Keyv itself raised. v5.1.6 exposes `.client` to attach to.
4. **Every synchronized scheduled tick** (`utils/schedule.ts`) — node-schedule
   invokes the async callback and drops the promise, and `clock.set()` is a Redis
   write. A cron firing during a blip = unhandled rejection = exit. Covered
   retention, telemetry, tus cleanup, cache-stats flush.
5. **A fifth, never identified** — same `MaxRetriesPerRequestError` from a floating
   command with no app frames in the stack. Closed with a process-level
   `unhandledRejection` net in `startServer` + a `directus_unhandled_rejections_total`
   counter. Still worth finding, so the net does not absorb a purge that should have
   been recorded.

**All upstream-shaped, not fork regressions** — verified by diffing `origin/main`
against the merge-base, not the edited tree ([[feedback_classify_file_by_base_revision]]).

**Timing:** commands fail after ~10.5s at defaults, not 30s
([[reference_ioredis_retry_semantics]]). Rejected fixes: `maxRetriesPerRequest: null`
(crash → unbounded hang) and `commandTimeout` (does not reduce exceptions; new
failure mode on a slow-but-healthy Redis).

Related: [[reference_node_unhandled_rejection]], [[feedback_capture_spawned_child_output]].

**Surviving the outage is NOT the same as answering during one (2026-08-19).** With
all five fixed, a blackbox cut showed the process alive and every cache-eligible
request blocked for the outage's whole length — node-redis queues offline commands
with no deadline. Fixed with `disableOfflineQueue: true`
([[reference_node_redis_offline_queue]]). Log volume needed its own fix too, since a
live process reconnects for the whole outage — see
[[project_directus_pr366_redis_resilience]], where all of this now lives.


**CORRECTION (2026-08-19, #366 merged as `2e175fe`): no missing `error` listener ever
killed the process.** The five-path attribution above is wrong on four of them, and
both corrections came from measuring rather than reading ([[feedback_verify_library_mechanism_before_documenting]]):

- **ioredis** (shared client, bus subscriber, synchronization, rate limiter) routes
  connection errors through `silentEmit` (`Redis.js:530`), which returns quietly at an
  empty listener list and `console.error`s the stack instead. It never rethrows.
- **node-redis / the four Keyv stores**: `@keyv/redis`'s `initClient()` (`index.js:840`)
  attaches `client.on('error', …)` **in its own constructor** and forwards to the Keyv
  instance, which Keyv re-emits — and `getCache()` already had `on('error')` on all
  four. The chain was complete before the PR.

What actually ended the process: **unhandled rejections** — the scheduled tick whose
`clock.set()` rejected, and commands settling after their caller was gone. Fixed in
`utils/schedule.ts` and `utils/report-unhandled-rejection.ts`.

So every listener the PR adds buys **observability**, not survival: one throttled,
labelled line instead of ~124 raw stack dumps per 25-second outage. Pinned by a
dependency-contract test in `cache.test.ts` so the wrong version cannot be written back.
