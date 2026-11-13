---
name: reference_directus_pm2_scale_cost
description: A pm2 scale costs (new workers) × one worker's boot, serially — so a large scale cannot be answered inside the 15s supervisor bound; a second scale sent mid-chain OVERSHOOTS (not a no-op); BB_READY_DELAY_MS is the rig knob that reproduces it
metadata:
  author: Jean Claveau
  type: reference
---

**A `pm2 scale` to N is not one call the daemon answers when it feels like it —
it is (N − current) round trips, one after another, each waiting out a worker's
boot.** Read in pm2 7.0.1:

- `PM2.scale` (`lib/API.js:1792`) → `addProcs`, which recurses:
  `Client.executeRemote('duplicateProcessId', …, ex.bind(this, proc, number))`.
  The next duplicate is sent from the **previous one's callback**, so the chain
  is serial and it lives in the **client**, not the daemon.
- `God.duplicateProcessId` (`lib/God/ActionMethods.js:226`) → `God.executeApp`,
  whose cluster branch (`lib/God.js:311`) calls back on `clu.once('online')` and,
  when `wait_ready` is set, holds further for the worker's `ready` message or
  `listen_timeout` — whichever lands first. The `listen_timeout` timer STARTS
  at `online` (`God.js:314-324`), so each fork's spawn→online is uncounted: a
  bound sized as N × `listen_timeout` needs flat slack on top (#491 round 3
  gives it `SUPERVISOR_TIMEOUT_MS`), and "no growth for 2 × `listen_timeout`"
  is the honest tell that no chain is still adding.

Two things follow:

1. **Cost.** A scale from 1 to 15 Directus workers is 14 boots end to end. The
   fork bounds every supervisor call at `SUPERVISOR_TIMEOUT_MS = 15_000`
   (`api/src/processes/supervisor/lib/client.ts:33`), so a scale that large
   always fails on a supervisor that is perfectly healthy. Root cause of
   [[project_directus_prewarm_deploy_failure]]; PR #491 first landed a
   `PREWARM_STEP_WORKERS = 2` walk, then (2026-09-16, commit `6edecfcda6`)
   replaced it with one untimed `requestScale(target)` for the whole target,
   not awaited — the bound never belonged on this call, only on dead-daemon
   detection, which stays on `readPool` each tick. `scaleApp` = the same call
   under `answeredInTime`, for callers that do want the bound.
   **Re-asking while a chain is in flight OVERSHOOTS, it is NOT a no-op:**
   `addProcs` computes `procsToAdd = N − procs listed at call time` (launching
   ones included) and each chain then adds its fixed count regardless of the
   other — 1→15 re-asked at tick 2 ends at 28 workers. "Same process number"
   is only answered when the pool is already AT N. So the autoscaler keeps one
   ask in flight (`prewarmAsked`) and re-asks only after it settled. Residual:
   a daemon that never calls back leaves it pending for the run — accepted,
   pm2-runtime is PID 1 on Railway so daemon death = container restart.
2. **The chain dies with the client.** `answeredInTime` reconnects on timeout,
   which tears the client's socket down — so the duplicates not yet *sent* never
   go out, while the one already in flight still completes in the daemon. That
   is why the pool went on growing past the failed scale and still never reached
   the target.

**Blackbox lever.** `tests/blackbox/tests/db/app/autoscale/rig.ts` exposes
`readyDelayMs` → `BB_READY_DELAY_MS`, which `worker.cjs` reports `ready` after.
Because of the above it is a **scale-cost** knob, not just a worker-boot knob:
`instances: 1` + `readyDelayMs: 3000` + a prewarm of 8 is 21s of boot behind the
15s bound, which is the production shape at a runner's size. `listen_timeout` in
the rig is 10_000, so keep `readyDelayMs` under it.

Beware: `wait_ready` appears in `lib/God/Reload.js` only, which reads as if it
were a reload-only flag. The start path honours it from `God.executeApp`
instead. See [[reference_directus_pm2_reload_internals]].
