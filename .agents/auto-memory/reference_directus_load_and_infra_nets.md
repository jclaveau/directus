---
name: reference_directus_load_and_infra_nets
description: catalog of Directus's existing load-shedding + shared infra primitives — check here BEFORE hand-rolling buffering/pub-sub/metrics/scheduling/rate-limiting in a Directus feature or review
metadata:
  type: reference
---

Before building (or accepting in review) buffering / cross-instance sync / metrics / scheduling in the Directus fork, check what already ships. Map (file:line as of 2026-07):

**Load-shedding nets:**
- **Pressure limiter** (`@directus/pressure`, `PRESSURE_LIMITER_ENABLED` default true) — `app.ts:~133`, mounted EARLY. Samples event-loop delay/utilization + heap/RSS every 250ms; `overloaded` → 503 + Retry-After. Front-door **admission control**; measures event-loop/memory, **NOT the DB pool**.
- **Rate limiters** — `middleware/rate-limiter-global.ts` + `-ip.ts` (rate-limiter-flexible). Front-door request-rate throttle.
- **DB pool** (knex/tarn, shared, default max ~10) — no saturation net; queues then throws. Pool-pressure signal = `db.client.pool.numPendingAcquires()` (callers waiting). Background jobs should yield on it.

**Shared infra primitives (reuse these, don't hand-roll):**
- **`useBus()`** (`bus/lib/use-bus.ts`, `@directus/memory` `createBus`) — redis pub/sub, `namespace 'directus:bus'`. Cross-instance events. Canonical use: `cache.ts` `schemaChanged`. Fire-and-forget, NOT durable (a down node misses it — pair with a durable key for boot catch-up).
- **`@directus/memory`** exports exactly: `createBus` (pub/sub), `createKv` (scalar get/set/increment/setMax), `createCache` (TTL), `createLimiter` (rate). **No stream/queue/durable-buffer** — a Redis-stream buffer (XADD/XRANGE/XDEL) has no shipped equivalent, hand-roll is justified.
- **`scheduleSynchronizedJob`** (`utils/schedule.ts`, `SynchronizedClock`) — canonical single-node cron (picks one node per tick). Use for background flush/reap.
- **`useMetrics()`** (`metrics/index.js`, `METRICS_ENABLED` default false) — prom-client in-memory registry, exposed at `GET /metrics` (admin or `METRICS_TOKENS`). Getter idiom: `register.getSingleMetric(name) ?? new Counter/Histogram(...)`. Owns a `directus_cache_*` / `directus_db_*` namespace. Ephemeral, aggregate counters/histograms only — NOT a durable per-event store (a per-key fact table is a separate, legit need). Add a labeled counter here for any aggregate an operator would scrape.
- **Telemetry** (`telemetry/**`) — 6h anonymous phone-home of install aggregates to an external URL. No local store. Not a sink for feature telemetry.

**Why:** PR #227 review found 2 real reinventions (a 5s poll instead of `useBus`; hit-ratio invisible to `/metrics`) and 3 justified hand-rolls (no primitive existed). A reinvention audit = for each subsystem a PR builds, grep `@directus/*` + `api/src` for an existing primitive first.

**How to apply:** [[feedback_review_finding_dispositions]] reinvention dimension. Reuse the scheduler + bus + metrics registry; hand-roll only the durable stream/buffer/watchdog (nothing ships). Related: [[reference_directus_generatejoi_not_filter]].
