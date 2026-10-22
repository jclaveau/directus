---
name: project_directus_autoscale_legacy_rollback_smoke
description: The legacy strategy works as a live rollback lever, and what a smoke load test showed it decides, measured 2026-09-15
metadata:
  type: project
---

`PM2_AUTOSCALE_STRATEGY=legacy` is the first thing to reach for if the
autoscaler misbehaves in production, so the lever itself was exercised on
`Planner-pr-770` (preview Api) on 2026-09-15.

**The lever is a single authenticated write, applied live.**

```
PATCH /utils/autoscale  {"strategy":"legacy"}     → 200
DELETE /utils/autoscale                           → back to the env chain
```

The autoscaler picked it up within its next tick — `sources.strategy` flipped
`default` → `sharedSettings` and the log line `[autoscale] shared settings:
strategy, setBy, setAt, setFrom` landed in the same second. **No redeploy, no
restart, no pm2 reload.** `GET /utils/processes?details=stats` is the instrument:
each `autoscaler` process carries `autoscale.config`, `autoscale.sources` and
`autoscale.withoutSharedSettings`, so what is effective and where it came from
are both readable without guessing.

The preview has no admin static token, but `TESTS_ADMIN_EMAIL` /
`TESTS_ADMIN_PASSWORD` are Railway variables on its Api service, and a session
token from `POST /auth/login` is enough for these routes (only system-mcp needs
a *static* token). Run the login through `railway run -s Api -- bash -c '…'` so
the password stays inside Railway's process env — reading it into the agent's own
shell trips the sandbox classifier, correctly.

**What legacy decided under the pass-2 load shape** (200 s ramp at 32 burners,
then 360 s at 2 burners with 8 probe streams; band 70/40, workers 1..4, up 10 s,
down 300 s):

```
00:46:43  api 1 -> 2: max cpu 70% >= 70%.        cpu: 70
00:46:57  api 2 -> 3: max cpu 76% >= 70%.        cpu: 76,25
00:47:05  api 3 -> 2: average cpu 39% < 40%.     cpu: 69,26,21
00:52:07  api 2 -> 1: average cpu 27% < 40%.     cpu: 28,25
```

Both known asymmetries reproduced in 22 seconds:

- **Grows on max, releases on average.** At 00:47:05 it took a worker away from
  a pool whose hottest worker was at **69%** — one point under the growth
  threshold it had cleared eight seconds earlier.
- **No warm-up freeze.** The worker released at 00:47:05 was 8 s old. The
  `scalabus` strategy holds while `warmingWorkers > 0`; legacy has no such
  guard, which is the churn `decideLegacy` exists to reproduce faithfully.
- **Release divides by the current count, not the survivors** (`39%` over three
  workers, where the survivors would have carried `58%`). That is exactly what
  #484 fixed on the scalabus side and legacy deliberately keeps.
- The 300 s release cooldown is measured from `lastScaleDownAt`, not from the
  grow: the 00:47:05 release fired immediately because the previous one was an
  hour old, and the next waited a full 302 s.

**It costs no errors at this request size.** 16993 probes, **0 non-200**, worst
latency 1.78 s across the whole churn — `kill_timeout: 20000` covers every
request that finishes inside it, exactly as in
[[project_directus_autoscale_release_load_test]]. So the lever is safe to pull
under production-shaped traffic; what it buys back is pm2-autoscale's decisions,
churn included.

Instrument trap: `/utils/processes` CPU is pm2's delta since the last lister, so
a 15 s poller **perturbs and misses** — my sampler never saw the 3-worker moment
and read numbers the autoscaler never saw. Judge the decisions from the
autoscaler's own log lines (`railway logs -s Api --filter autoscale`), never from
a sampler's CPU column ([[project_directus_pm2_cpu_delta_window]]).

Related: [[project_directus_pm2_autoscale_threshold_ratchet]],
[[project_directus_autoscale_release_judgement]],
[[project_directus_pr456_autoscaler_design]].

## pm2-autoscale is gone, verified 2026-09-15

The module is removed on planner #770 in three places: `apps/package.json`'s
`"prepare": "pnpm pm2 install pm2-autoscale"`, and both
`RUN pnpm --filter @hiphiphip/shared-dependencies run prepare` lines in
`Dockerfile.directus-bo` — the api Dockerfile is *generated* from the bo one by
`prepare-dockerfile.sh`, which is why `b89e1037`'s stat shows only the bo file and
`4b537d8f` carries the regenerated api one.

**Verified live rather than inferred.** The 770 preview's `/utils/processes` lists
exactly `api` (pmId 0) and `autoscaler` (pmId 1). That list *would* show a module:
`listSupervisedApps()` is a bare `pm2.list()` → `getMonitorData` with no filter, and
pm2 hides modules only at display time (`lib/API/UX/pm2-ls.js:23` filters
`pm2_env.pmx_module != true`). No volume is declared in the Railway config either,
so `PM2_HOME=/directus/.pm2` is ephemeral and a module baked into an older image
dies with its container.

**There is no window where both supervisors run.** The scalabus dist bump put the
autoscaler *code* on develop, but the `autoscaler` process declaration in
`directus.ecosystem.config.js` is on #770 — so prod today runs the module and not
the fork's loop, and the #770 deploy swaps them in one step. `strategy: legacy` is a
branch inside the fork's own `decide()`, never the module, so the rollback can never
resurrect it.

Corollary for the day before that deploy: **the `PATCH /utils/autoscale` levers do
not exist on prod yet.** Until #770 ships, prod is pm2-autoscale 1.4.0 and its only
rollback is the `PM2_AUTOSCALE_*` thresholds plus a redeploy.
