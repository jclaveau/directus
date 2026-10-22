---
name: directus_pr447_pm2_supervisor_cpu
description: PR #447 pm2 supervisor/CPU fix + processes admin page charts — root cause, design decisions, settled exceptions
metadata:
  author: Jean Claveau
  type: project
---

MERGED (`3aa5b885e8` on hhh-dev). Root cause found while chasing why dev's PM2
autoscaler never showed CPU: `report-processes.ts`'s `shouldReportSupervisor()` was
`supervisorAvailable() && instanceNumber() === 0` — **only pm2 instance 0 ever attaches
the container-wide `pm2 list`.** That's fine for a fresh pool, but `NODE_APP_INSTANCE`
keeps incrementing as `pm2-autoscale` releases/adds workers (and a 3am `cron_restart`
recycles them), so a pool that has scaled even once can permanently lose instance 0 —
exactly the steady state on an autoscaled service, i.e. the report drops its CPU view
precisely on the services the page exists to watch. Confirmed live on dev Api: stable at
instances 2 and 3 across 6 polls, no 0, `supervisor: unavailable` and every `cpuPercent`
null forever. Fix: every supervised process attaches its own `pm2 list()`; the collector
already took the first non-null one per replica, so no new coordination was needed —
just removing the `instanceNumber() === 0` gate. Second fix in the same root cause:
`supervisorAvailable()` tested only `'PM2_HOME' in process.env`, and the bo/Backend
Dockerfile sets `PM2_HOME` unconditionally even though Backend runs bare `directus
start` with **no pm2 at all** (see [[project_directus_planner_bo_no_pm2]]) — so it
reported `supervisor: unavailable` (implying broken) instead of `none` (implying
absent). Fixed by also requiring `pm_id`.

**Display, settled decisions (don't re-raise):** CPU cell reads as a share of one core
(matches how PM2 measures); two charts (per-process CPU, per-process memory) plus a
deployment-vs-cgroup-limits summary chart at the top, axis **pinned 0–100%** (not
rescaled to peak — a self-scaling chart hides headroom, which is the whole point of a
limits chart); a series is keyed by **slot, not pid** (PM2 renumbers a restarted worker,
which would otherwise split one worker's line into two); a process missing from a sample
plots as a **gap, never zero** (a released/dead worker drawn at zero reads as idle, the
opposite of what happened); an unmeasured total is `null`, not zero (undercounting a
limits chart is the wrong direction to be wrong in); the CPU chart states plainly when
no supervisor answered instead of drawing a flat zero line.

**`host-capacity.ts` (new)** — the ceiling for the top chart. Reads cgroup v2
(`memory.max`, `cpu.max`) then v1, falls back to `os.totalmem()`/`availableParallelism()`
only for a genuinely uncapped process — `os.totalmem()` alone overstates a Railway
container's real limit by an order of magnitude. v1's uncapped sentinel is `LONG_MAX`
rounded to a page, treated as "no limit" rather than an absurd 8-exabyte one.

**Not fixed here, still open:** `preview-admin.yml`'s self-cancel bug (see
[[feedback_directus_redispatch_preview_freely]]) — unrelated to this PR's diff, just
surfaced while iterating previews on it. `create-metrics.ts` keeps its own separate
`isPM2 = 'PM2_HOME' in process.env` with the same false-positive shape — feeds metrics
aggregation, not this report, deliberately left for its own PR.

**Why:** planner's PM2 autoscaler couldn't be observed at all — this closes that gap for
Api; Backend never runs pm2 so it's out of scope by definition, not an oversight.

**How to apply:** any future "why is CPU null on the processes page" report on an
autoscaled service — check instance numbering first, not credentials or the bus timeout.
