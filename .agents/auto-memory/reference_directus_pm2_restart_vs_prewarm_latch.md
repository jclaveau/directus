---
name: reference_directus_pm2_restart_vs_prewarm_latch
description: which pm2 restart scope re-triggers the autoscaler's prewarm (container/pm2-runtime restart only) vs which ones leave it latched shut (app-level reload/restart, carriesRestarts gate)
metadata:
  author: Jean Claveau
  type: reference
---

Three different things can be called "restarting pm2", and only one re-arms
[[project_directus_prewarm_deploy_failure]]'s prewarm:

- **`pm2-runtime` / container restart** (Railway redeploy, nightly
  `cron_restart`) — the whole ecosystem boots fresh, autoscaler included:
  `prewarmed = false`, api workers' `restart_time` at 0 → prewarm fires. This
  is the #490 incident path.
- **`pm2 reload api` / `pm2 restart api`** (or the admin panel's restart
  button) — only the api app cycles. The autoscaler process keeps running so
  `prewarmed` stays latched true → no prewarm. Also flips `carriesRestarts`
  true (api workers' `restart_time` > 0), which shuts the prewarm gate for the
  rest of the run even if the latch were somehow reset.
- **`pm2 restart autoscaler`** (only the autoscaler app) — fresh
  `prewarmed = false`, but the gate also reads the **api pool's**
  `restart_time`. On a pool that was never reloaded since the daemon started,
  prewarm fires again and walks it back to target. On one that ever reloaded,
  `carriesRestarts` shuts it regardless.

Implication for building a restart-triggered smoke/load arm: `pm2 restart
autoscaler` alone only re-triggers prewarm if the api pool sits below target
AND has never been reloaded — needs `pm2 scale api 1` (deletes workers,
doesn't bump survivors' restart counters) first, then the autoscaler restart,
then watch. Fragile precondition; a real redeploy is the clean way to exercise
this path (chosen for the #491 CI load test — see
[[project_directus_prewarm_deploy_failure]]).
