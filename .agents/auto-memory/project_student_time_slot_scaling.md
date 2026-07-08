---
name: project_student_time_slot_scaling
description: The 10gb+ DB pain table is student_time_slot; parked Timescale-hypertable + clean composite-PK plan
metadata:
  type: project
---

`student_time_slot` (planner time-slots collection) is the table behind jean's "DB is 10gb+, slow"
problem: **13.9M rows, 2.6 GB, indexes (1.37 GB) larger than the heap**. Partition axis is
`day date NOT NULL`; surrogate PK `id int` (sequence); dominant filter `user_created`. Already
hand-partitioned by year via ~20 partial indexes (`WHERE day in YYYY`), most `idx_scan=0` (dead
weight, needs manual yearly extension). Only ONE incoming FK: `student_time_slot_note.time_slot`.
Bloat lives in OTHER zero-row tables (~1 GB reclaimable via VACUUM FULL: student_schedule_segment_
student_course, directus_notifications, grouped_notification_directus_users).

**Parked plan** (most precise, not started): `.agents/plans/student-time-slot-timescale-composite-pk.md`.
Approach = TimescaleDB hypertable on `day` (compression + native chunk indexes replace the manual
scheme; keep-all, no retention) + patch Scalabus to support composite PK `(day, id)` *cleanly*
(designated addressing key = `id`, additive `primaryKeys?: string[]`, ~6–8 files) rather than the
upstream-declined ~94-file full-composite rewrite (Directus Discussion #12137). Hard limit: hypertable
forbids `UNIQUE(id)` → incoming FK becomes Directus-meta-only, cascade moves to app/trigger.

**DIAGNOSIS (2026-06-26) — hypertable is NOT justified by memory; plan stays parked.** The trigger
was a flat ~9.5 GB Railway memory graph on the timescale-ha Postgres. Measured on PROD: box = **16 GB**,
`shared_buffers = 8 GB` (50%, best-practice ~25%), `db_size = 6.5 GB`, **cache hit ratio = 100%**
(whole DB resident). The flat graph is the shared_buffers *allocation*, not data pressure — compression
can't lower it and buys ~0 cache density (already 100% cached). **Real fix for the number: drop
shared_buffers 8→4 GB** (Railway Postgres config, 5 min, perf unchanged). If the pain is *slowness* not
the number: suspect **write amplification from 24 indexes** (~20 are `idx_scan=0` dead — drop them) or
bad query plans, not memory/IO. Revisit the hypertable only when db_size approaches RAM and hit ratio
falls < ~0.98.

**STATUS (2026-06-26): DONE.** `shared_buffers` lowered 8→**4 GB** via ALTER SYSTEM + restart;
applied (`pending_restart=f`), prod memory graph dropped ~4 GB as predicted. Hit ratio was 96% cold
right after restart, warms back to ~100%. No hypertable / fork patch needed — one config value solved
the "10gb memory" concern. Prod facts: timescale-ha on Railway, env `production`, service
`Postgres-HipHipHip-test`, `NO_TS_TUNE=true`. `railway run` is LOCAL not in-container — see
[[reference_railway_run_is_local]], [[reference_pg_shared_buffers_alter_system]]. shared_buffers can't
be made usage-elastic (OS page cache is the elastic layer; no live-resize extension exists).

Inspect PROD DB: from `planner/` repo root, `pnpm exec railway environment production` then
`pnpm exec railway run --service Postgres-HipHipHip-test bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d railway -tAc "<SQL>"'`
(see [[reference_pn_db_query_local]] for the LOCAL equivalent). Related: [[project_directus_db_clients]].
