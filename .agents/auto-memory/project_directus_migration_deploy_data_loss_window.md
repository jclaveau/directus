---
name: project_directus_migration_deploy_data_loss_window
description: A rename/drop migration guarantees a data-loss window sized to the migrating service's migrate time — health-hold gates HTTP traffic but not the API service's own background writers; option (a) shipped as #451/#452, and the answer to "why did it get traffic" is that it never did
metadata:
  author: Jean Claveau
  type: project
---

Measured on a prod consumer's deploy (2026-09-07 22:27, migration
`20260826A-name-the-cache-stats-tables`, a rename): its API service and its migrating
service are independent services deploying the same commit in parallel. The migrating
service runs `directus:init` (migrate then start); **the API service never migrates**.
The API service came up at 22:27:53 already running post-migration code (new table
names); the migrating service didn't apply the
rename until 22:30:24 — a 2m40s gap.

`/server/health` 503s for that whole gap
([[project_directus_health_holds_on_outstanding_migrations]]), which protects HTTP
traffic — Railway won't switch traffic to a 503'ing container, so the previous
deployment kept serving reads/writes. **It does NOT protect the API service's own background
telemetry writer**, which starts on boot regardless of health state and isn't wired to
the same outstanding-migrations watch. Every cache-stats insert during the gap hit
`42P01 relation does not exist` and was dropped: 451/490/200/77/387/500/50/255/310
events per 10s tick, **~2,700 events lost**, same shape as
[[project_directus_cache_stats_prod_incident]] but a different cause (migration
ordering, not the autokill/escaping bugs).

**So any rename/drop migration has a guaranteed data-loss window** equal to however
long the migrating service takes to migrate after the API service boots, for any background writer that targets the
renamed/dropped object immediately.

Fix options discussed: (a) gate the schedules on the same outstanding-migrations watch
that gates health; (b) make the drain tolerate `42P01` by holding its buffer instead of
dropping; (c) have the API service wait for migrations to be *applied* before starting background
schedules at all. **(a) shipped** — issue #451, PR #452
(`v11.10.1-fix/hold-schedules-for-migrations`): `migrationsAreOutstanding()` in
`api/src/outstanding-migrations.ts`, read by `scheduleSynchronizedJob` **before**
`clock.set()`. (b) remains available as a belt to those braces.

**Answered: the API service never got traffic.** The prod log for the whole 22:27:59→22:30:33 window
contains nothing but its own `GET /server/health 503` probes, so the health gate worked
exactly as designed and Railway never switched over. The work was **outbound, not
inbound**: `drainCacheEvents()` (`api/src/cache-events.ts:769` → `drainCacheEventStream()`
at `:784`) reads the **shared Redis stream** that the old, still-serving containers kept
filling. `api/src/app.ts:104-110` only `logger.warn`s about outstanding migrations and
gates nothing, so `createApp()` runs on to start every schedule at `app.ts:401-405`.
So the cross-service question does not arise: nothing needs to wait on the migrating service, because the API
service's *own* reading of the shared migrations table was already correct — it just was not wired
to anything but health.

**The amplifier, and why the gate sits before the claim:** `scheduleSynchronizedJob`
(`api/src/utils/schedule.ts`) hands each tick to exactly one node cluster-wide via
`SynchronizedClock.set()`. The migration-blind node won that slot and thereby locked
every healthy node out of the job — it did not merely fail its own work. Returning before
the claim leaves the slot to a node that can run it, so one change fixes both.

Seven registration sites ride that function, so the gate also covers retention, telemetry,
tus cleanup, **every user cron flow** (`flows.ts:224`) and **every extension schedule**
(`extensions/manager.ts:861`). `schedules/metrics.ts:50` is deliberately excluded: plain
node-schedule, per-node with its own lock, scrapes rather than writes, no slot to steal.

**#453, found reviewing #452:** the same defect class survives one layer down. A callback that
declines for a *node-local* reason after `clock.set()` has already spent the cluster's only
slot for that tick. Three in the cache-stats drain — `cacheStatsConfigured()`,
`cacheEventDrainInProgress`, `dbPoolSaturated`. Correlation decides the cost and inverts the
obvious ordering: the process-local **in-progress latch** is the expensive one (uncorrelated —
the one busy node stands 31 idle ones down, exactly when a backlog exists), while
`dbPoolSaturated` reads worst but is nearly free (shared pool, so the other nodes were
saturated too). Fix shape is a pre-claim `canRun` guard, generalizing where #452 put the
migration check.
