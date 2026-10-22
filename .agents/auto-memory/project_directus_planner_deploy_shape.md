---
name: project_directus_planner_deploy_shape
description: How Planner deploys this fork on Railway — API container skips bootstrap, PM2 now starts at base PM2_INSTANCES=1 (2026-09-08+, was 2) then autoscales, autorestart on, healthcheckPath /server/health
metadata:
  author: Jean Claveau
  type: project
---

**Updated 2026-09-08 (`a9f3eff6`): base `PM2_INSTANCES` is now `1`**, not `2` — the
dev-only override described below was folded into the base `.env` since Api is the only
service that reads it (prod already had the same value set as a Railway variable,
independently). See [[project_directus_pm2_autoscale_ramp_measured]] and
[[project_directus_pm2_autoscale_threshold_ratchet]] for what changed the same day
around the autoscaler that grows the pool from this floor.

From `planner/apps/directus/` (the consumer of this fork). Load-bearing when reasoning
about boot-time guards:

- **`directus-api.railway.json`**: `healthcheckPath: "/server/health"`, no timeout
  override → Railway's default 300 s. Same for `directus-bo`.
- **The API container never migrates.** `railway_start_api.sh` is
  `exec pm2-runtime start /ecosystem.config.js` — no `directus:init`. The back-office does
  (`CD=true pnpm directus:init; CD=true pnpm directus start`), and they deploy in parallel.
- **`PM2_INSTANCES`.** Base layer sets `2`; the `=1` override lives only in the dev
  Api env file, so **prod boots 2 workers** (`api:1` then `api:2` starting serially in
  the boot log), not one — see [[project_directus_planner_bo_no_pm2]] for the
  base-vs-override split. `pm2-autoscale` then grows toward
  `PM2_AUTOSCALE_MAX_WORKERS=32` on CPU. So "32 pollers at boot" is wrong either way —
  it's 2 in prod, 1 in dev.
- **`PM2_AUTO_RESTART=true`**, so a worker that exits is restarted with
  `exp_backoff_restart_delay: 100`; `pm2-runtime`'s auto-exit never fires.
- **`cron_restart: '0 3 * * *'`** — a nightly restart that is NOT a deploy, so no
  healthcheck runs on it.
- `apps/directus/builtin.ecosystem.config.js` is a verbatim copy of this repo's
  `ecosystem.config.cjs` (`wait_ready: true`, `listen_timeout` from `PM2_LISTEN_TIMEOUT`,
  unset → pm2's `GRACEFUL_LISTEN_TIMEOUT` of 3000 ms).

**Why it matters:** on a cold `pm2-runtime start`, listen_timeout expiry is benign —
`lib/God.js` just calls `readyCb` and starts the next instance, it does not kill. Only
`pm2 reload` retires the old worker, and `pm2-runtime` never reloads.

See [[project_directus_health_holds_on_outstanding_migrations]].
