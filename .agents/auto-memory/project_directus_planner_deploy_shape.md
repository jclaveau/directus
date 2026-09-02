---
name: project_directus_planner_deploy_shape
description: How Planner deploys this fork on Railway — API container skips bootstrap, PM2 starts ONE worker then autoscales, autorestart on, healthcheckPath /server/health
metadata:
  type: project
---

From `planner/apps/directus/` (the consumer of this fork). Load-bearing when reasoning
about boot-time guards:

- **`directus-api.railway.json`**: `healthcheckPath: "/server/health"`, no timeout
  override → Railway's default 300 s. Same for `directus-bo`.
- **The API container never migrates.** `railway_start_api.sh` is
  `exec pm2-runtime start /ecosystem.config.js` — no `directus:init`. The back-office does
  (`CD=true pnpm directus:init; CD=true pnpm directus start`), and they deploy in parallel.
- **`PM2_INSTANCES=1`.** One worker at deploy; `pm2-autoscale` grows it to
  `PM2_AUTOSCALE_MAX_WORKERS=32` on CPU afterwards. So "32 pollers at boot" is wrong —
  it is one.
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
