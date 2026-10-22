---
name: project_directus_issue495_release_bound
description: Issue #495 (filed, not fixed) — the autoscaler's 15s supervisor bound is shorter than the planner's 20-25s drain window, so a release of several workers is a release of several chances to time out
metadata:
  author: Jean Claveau
  type: project
---

`releaseWorker(pmId)` = `pm2.delete(pmId)` wrapped in `answeredInTime(…, 15_000)`
(`SUPERVISOR_TIMEOUT_MS`, `api/src/processes/supervisor/lib/client.ts:33`). pm2
only answers a delete once the worker has actually exited: SIGINT → terminus
keeps sockets open for in-flight requests up to the planner's
`SERVER_SHUTDOWN_TIMEOUT=20000` → `database.destroy()` → exit, SIGKILL at
`kill_timeout: 25000` if it hasn't. A worker mid-drain on a 16s request exits
(and pm2 answers) at ~16s — after the autoscaler already gave up at 15s.

**What the 15s timeout does, concretely** (`client.ts:167-208`):
1. `answeredInTime` resolves `OUT_OF_TIME`, swallows the late callback.
2. `reconnectToSupervisor()` fires — meant for a dead daemon, but here the
   daemon is alive and doing exactly what was asked.
3. Throws `the supervisor did not answer a release of worker N in 15000ms` →
   the tick fails, logged as `[autoscale] a tick failed`.
4. `index.ts:395` sets `lastScaleDownAt = Date.now()` **after** the await, so a
   failed release does not reset the cooldown — the pool can release again one
   tick (1s) later, once it re-reads the now-smaller pool. Sizes stay correct;
   the anti-flap clock skips once.

**Pre-existing, not a regression** — any single release of a worker holding a
>15s request already hit this. [[project_directus_pr494_proportional_release]]
makes it more likely: a release of N workers is N independent chances, and
`Promise.allSettled` waits for the slowest, so the tick fails if *any* one
drains past 15s. Concurrent timeouts share one reconnect
(`reconnecting ??=`), so it degrades gracefully (more failed ticks, never a
hang) rather than catastrophically.

**Proposed fix (not built):** `releaseWorker(pmId, timeoutMs)` with the loop
passing `supervisor.killTimeout + margin` (`readPool()` already returns
`AutoscaleSupervisor.killTimeout`) instead of the generic 15s bound — a late
answer from an actual drain becomes an answer, and the reconnect stays reserved
for a daemon that really went away. Optionally set `lastScaleDownAt` in a
`finally` so a failed-but-completed release still counts for cooldown purposes.
Trade-off flagged in the issue: 25s+margin per tick is a long time for the loop
to be blind; the alternative (fire-and-forget the delete, let the next tick
read the result) loses the "the tick knows what it left" property the design
leans on — issue should weigh both, left to jean.
