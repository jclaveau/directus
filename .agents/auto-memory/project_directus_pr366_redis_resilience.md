---
name: project_directus_pr366_redis_resilience
description: PR #366 "survive an unreachable Redis" — split out of #358 and merges BEFORE it; carries the 5 listener fixes + log throttling + disableOfflineQueue; settled points and known coverage gaps
metadata:
  type: project
---

**#366**, branch `v11.10.1-fix/redis-outage-resilience`, base `v11.10.1-hhh-dev`.
**#358 is stacked on it — merge #366 first.** Split 2026-08-19; verified by content
(`git diff <old-358-head> <new-358-head>` empty).

Carries the five fixes from [[project_directus_redis_outage_kills_process]], plus:

- **`warnOncePerConnectionOutage`** (`api/src/redis/lib/`) — the listeners keep the
  process alive, which means the reconnect loop runs for the whole outage; unthrottled
  that is a warn every couple of seconds × 6 clients until someone notices. Logs one
  line per DISTINCT message, resets on `ready`.
- **`disableOfflineQueue: true`** on the Keyv client — the real find. Surviving the
  outage was not enough: every cache-eligible request BLOCKED for its full duration
  (one GET hung 180s in CI). See [[reference_node_redis_offline_queue]]. Without the
  blackbox test this would have merged claiming "losing Redis costs hit ratio only".

**Blackbox:** `tests/blackbox/tests/db/routes/items/redis-outage-survival.test.ts`
(TCP proxy in front of 6108, destroy it, assert the API still answers).
- The scheduled-tick path needs no new knob: **`cache-stats`'s `FLUSH_CRON` is
  `*/10 * * * * *`, the only sub-minute schedule in the codebase** — set
  `CACHE_STATS_ENABLED=true` and hold the cut past ten seconds.
- Log-volume assertion bounds BOTH ways (≥1 so a renamed label cannot pass vacuously,
  ≤5 against the few hundred reconnects the outage produces).

**Known gaps, deliberate:** the process-level `unhandledRejection` net masks the
individual listeners — a bb case cannot attribute survival to one site, and the
product should not grow a knob to disable the net just for a test.
`directus_unhandled_rejections_total` stays unit-only (provoking a real rejection on
demand is not worth a case). Only the response-cache store is exercised, not the
system/schema/lock ones.

**MERGED 2026-08-19 as `2e175fe` (merge commit, 31 commits kept). Settled — do NOT
re-raise:**

- **The narrative was corrected twice** — see [[project_directus_redis_outage_kills_process]].
  No missing listener killed the process; the listeners buy observability.
- **Rate limiter: no limit at all while Redis is unreachable.** jean chose this over a
  per-process `insuranceLimiter` budget — N instances would each grant the whole
  budget, which is neither the configured limit nor a knowable one. Redis keeps its
  counters and TTLs, so counting resumes mid-window. `rejectIfRedisNotReady: true` is
  required with it: without it the fallback is reached only after ioredis gives up
  (~10s/request — the bb case timed out at 120s and that is how it was found).
- **One throttle per cache, origin in the line** (`[response-cache] connection:` vs
  `store:`), not two labels. The same failure text from both sides is one failure seen
  twice — counting it twice is how the log grows with traffic again. Attribution needs
  a `WeakSet` + `queueMicrotask`, because `@keyv/redis`'s forwarder is registered
  before ours and would otherwise claim every socket error as a store error.
- **Blackbox bounds are a slope, not a constant**: windows of 3 and 12 reads, asserting
  `busy - quiet < (busyReads - quietReads) / 2`. Measured 3 distinct failures per
  outage either way (`Socket closed unexpectedly`, `The client is offline`,
  `AggregateError`), so a constant bound of 6 had no headroom.
- **A silent outage window is legitimate** — the throttle rearms on the client's
  `ready`, not on the proxy reopening, so a window cut before recovery is observed is a
  continuation of the previous outage.
- **`fast-check` 4.9.0 landed** (catalog + api devDeps) — first property-based test in
  the repo. It found the alternating-failure bug at generated run 29
  ([[feedback_coverage_cannot_express_sequence]]).

**Follow-ups left open:** #367 (blackbox contention flakes), the vacuous
`tests/blackbox` typecheck, and #358 still based on the merged branch.
