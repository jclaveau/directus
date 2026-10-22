---
name: directus_planner_bo_no_pm2
description: Planner's bo/Backend service runs bare node with NO pm2 at all; only Api uses pm2 — don't apply pm2/autoscale reasoning to bo; base .env sets PM2_INSTANCES=2 for all services, api override to 1 is deliberate
metadata:
  author: Jean Claveau
  type: project
---

The planner's two Railway Directus services differ in kind, not just config:

| | Backend (bo) | Api |
|---|---|---|
| start CMD | `railway:start:backend` = `directus:init; directus start` — **bare node** | `railway:start:api` → `railway_start_api.sh` → pm2 |
| pm2-autoscale env | none set anywhere → dead-code `\|\| 2` fallback, never read | `.env.dev.cd.railway.api` MAX_WORKERS=4/threshold 40; `.env.prod.cd.railway.api` MAX_WORKERS=32/threshold 60 |
| `PM2_HOME` | set unconditionally by the Dockerfile anyway (misleads `supervisorAvailable()`, fixed in #447) | set, meaningfully |
| `ROLLDOWN_WORKER_THREADS`, `PM2_INSTANCES` | meaningless if set here | meaningful |

A whole investigation this session (load probes, `PM2_INSTANCES=1`, dev-bo redeploys)
targeted `bo.dev.hiphiphip.app` on the theory that "max_workers is only 2" was a bo
autoscale problem — every one of those numbers (OAS-storm 120rps, deep-read 86rps,
hash-generate 48rps/0-throttled) measured **one bare node process**, not an autoscaler,
because bo never runs one. The `.env.dev.cd.railway.bo` file's autoscale block is inert:
nothing reads it. `PM2_INSTANCES=1` was mistakenly committed there (`8de53418`) before
being caught and moved to `.env.dev.cd.railway.api` (`0c083cfa`), where it actually
matters.

**Correction (superseded a wrong claim from the prior pass of this memory):** api was
NOT "already starting at 1 with headroom to 4". `apps/directus/env/.env:103` sets
`PM2_INSTANCES=2` in the **base layer that every service inherits**, and
`builtin.ecosystem.config.js:18` reads `instances: env.PM2_INSTANCES ?? 1` — so api
actually started at **2** (matching the `instances 2,3` seen in idle polls), leaving
autoscale only 2 slots to grow into out of `max_workers=4`. `0c083cfa` overrides the
base to **1**, deliberately, so the first autoscale spawn becomes observable — confirmed
live: a smoke load test (`apps/domain/tests/smoke/pm2-autoscale-load.smoke.spec.ts`,
committed to planner `develop` at `37f8eb8f`, previously untracked) drove 1→2→3→4
workers in 16s and captured `requestCountersSeen` spanning 7 distinct instance numbers
(4→25) from a pool that never exceeded 4 — live confirmation of the `NODE_APP_INSTANCE`
drift #447 was built to handle.

**Why:** the split wasn't obvious from either env-file naming (both are `*.cd.railway.*`)
or from `directus.ecosystem.config.js`'s single shared `pm2_autoscale` block, which reads
as if it applies uniformly.

**How to apply:** any pm2/autoscale/CPU/worker-count question about the planner —
confirm which of the two services first. `railway_start_api.sh` / a bare `directus
start` invocation in `railway:start:<name>` is the tell; don't infer from the env file's
name alone.
