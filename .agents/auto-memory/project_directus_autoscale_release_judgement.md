---
name: project_directus_autoscale_release_judgement
description: A release is judged on the workers it would leave, and pm2 picks the victim — the two halves of the scale-down defect found by the 2026-09-13 load test
metadata:
  type: project
---

Two independent defects on the scale-down path of the fork's autoscaler
(`api/src/processes/autoscale/`), found by a load test against the preview
environment on 2026-09-13. They are unrelated and must not be conflated.

## How many workers leave — FIXED, commit `20b13c500c`

`decideScalabus` released on `average(cpuPercents) < releaseCpuThreshold`. A
worker reports 0% CPU when nothing has been routed to it as readily as when the
pool has spare capacity, and keep-alive makes the first case common (node cluster
round-robins **new connections** only, so clients stay pinned to the workers they
already hold sockets to). `[70, 0]` against a threshold of 40 averaged 35 and
shed the worker, leaving the survivor at 70.

Fix: divide the same total by `workers - 1` — the workers the release would
**leave** — via a new `averageOver(values, workers)` that `average` now delegates
to. The projected value is never below the plain average, so it only ever holds
back a release the average would have made; `[20, 0]` still releases.

The **add** path deliberately keeps reading the pool as it stands: growth answers
the pressure there is now, not the pressure a change would leave behind.

A warming worker is in the pool's size but not in its statistic, so the divisor
would not match the workers being judged — the release now returns
`N worker(s) still warming up` rather than projecting over it. The add path
already freezes on `pendingWorkers > 0` for the same reason. Safe because
`AUTOSCALE_BOUNDS.minWorkers.low === 1` (`packages/constants/src/autoscale.ts:47`)
and the branch is inside `workers > config.minWorkers`, so `survivors >= 1`.

`decideLegacy` is untouched — it still releases on the plain average, because it
reproduces pm2-autoscale 1.4.0 exactly.

## Which worker leaves — #482 FIXED in `275ea4ed0d`, #483 later/maybe

`decide()` returns a **count**; `scaleApp()` calls `pm2.scale()` and pm2 chooses.
`rmProcs` walks `procs[i++]` from `i = 0` (`pm2/lib/API.js:1807`), ascending
`pm_id`, so it always deletes the **oldest** worker — which under keep-alive is
the one holding the most in-flight work. That is what produced the 502: the
victim held a 27 s `POST /items/student_course`.

- **#482 — landed** as `lib/choose-victims.ts` on the #456 branch, with a
  blackbox arm (`e171705a54`) and confirmed live on the preview by the
  2026-09-14 load test ([[project_directus_autoscale_release_load_test]]). The
  shipped ranking is `nothing in flight` → `reported nothing at all` → `fewest
  in flight`, `pm_id` tiebreak — RSS is NOT a rank in it, and silence ranks
  below a reported idle because silence is not idleness. Originally specced as
  `zero in flight` → `lowest RSS` → `oldest` (tiebreak = today's behaviour, so an outage degrades to the status
  quo). No in-flight signal exists: the metrics registry has no `Gauge`, and
  `report-processes.ts` `runtimeStats()` rides `useBus()` = Redis, which the
  autoscaler must survive without. Redis-free transport already in the tree is
  pm2's own channel (`server.ts:213` `process.send`, `client.ts:254`
  `sendDataToProcessId`). Costs no pm2 surface: `pm2.delete` **is** typed
  (`pm2/types/index.d.ts:87-91`) while `pm2.scale` is **not**, and both reach
  `God.deleteProcessId`.
- **#483** — RSS ranking, gathering the measurements. `monit.memory` **is** RSS
  (dev MCP: `supervisor.memoryBytes === runtime.rssBytes === 231960576`), already
  collected at `pool.ts:120` and windowed as `memoryMegabytes` at
  `pool-samples.ts:61,117`, and read **only** by `decideLegacy`'s add-side
  free-RAM guard (`decide.ts:75-84`). RSS is a high-water of transient allocation
  (238 MB idle → 371 MB after 1000 reads, heapUsed flat), so it tracks *traffic
  served*, not age — it therefore converges on pm2's oldest-first pick and
  **would not have prevented the 502**. It belongs strictly below idleness.

The drain budget that turned the dropped request into a 502 is a third, separate
thing: planner issue the-HipHipHip/Planner#771.
