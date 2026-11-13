---
name: project_directus_pm2_autoscale_threshold_ratchet
description: 2026-09-08 prod incident — pm2-autoscale's max-triggered add vs average-gated release ratchets the pool up forever when the threshold sits inside a normal worker's CPU range; root cause of the second half of the day's outage, separate from the heap-cap crash loop
metadata:
  type: project
---

Second, independent failure the same day as [[project_directus_worker_heap_cap_incident]]
— the heap fix stopped the crash loop, but prod kept climbing toward 32 workers anyway.

**Mechanism, confirmed from `pm2-autoscale@1.4.0` source (`core/pm2.js`):**
- Scale-**up** triggers on `maxCpuValue >= scaleCpuThreshold` — the **hottest** worker.
- Scale-**down** lives in the `else` branch of that same check and reads the **average**
  vs a lower release threshold. While the max is over threshold, release is never
  evaluated at all, regardless of the average.
- Add is gated every `min_seconds_to_add_worker` (10s); release is gated every
  `min_seconds_to_release_worker` (300s) — adds win roughly 30:1 when both fire.

**What actually happened:** threshold was lowered 60→50 (reasoned as "a worker at
50-60% has no headroom for a burst"). One or two workers doing steady background work
(cache-stats drain, the synchronized-job lease holder) sit permanently at 48-52% CPU —
not a burst, just their normal shape. At threshold 50 that's a **permanent** scale-up
signal: adding workers doesn't cool the busy one, so nothing ever satisfies it. The pool
climbed to ~21 before the equilibrium point (where even the hottest worker happens to
dip under 50) and would have kept drifting toward the 32 ceiling given more load.

```
needs increase workers because 52>50.
CPUs: 35,31,42,26,50,25,33,45,29,52,24,26,22,31,27,38,44,45,16
```
The hot slot moves between 2-3 workers, not one fixed one — it's a floor effect of
background-job CPU shape, not a single culprit process.

**Why the dev smoke test never caught it:** the load spec hashes with argon2, which pins
*every* worker near 100% CPU. That can only expose a threshold way above normal (60 is
"safe" under it) — it structurally cannot reveal a threshold that sits *inside* a
worker's normal operating range, which is exactly the failure mode that shipped.

**The fix:** revert to threshold 60 (empirically safe — prod ran on it for a long time
with no such ratchet). Cooldown is not the cause (it only sets how fast the ratchet
climbs, ~7s/worker at 3s cooldown vs ~15s/worker at 10s) — keep it independently
conservative while confidence is still low.

**How to apply:**
- **With a max-triggered add, the threshold is not a headroom target — it has to clear
  what a normal, healthy worker's CPU ever reaches**, including steady background work.
  A value "inside the spread" is satisfied permanently, not just sometimes.
- `os.freemem()` in the module's pre-add memory guard reads the **container host's**
  free memory, not the container's — it will never block a scale-up. No real ceiling
  protection exists today; see [[project_directus_pm2_autoscale_ramp_measured]] for
  where `PM2_INSTANCES`/cooldown currently live.
- Any load-test signal built to validate an autoscale threshold must produce workers at
  a *range* of CPU levels (including near the candidate threshold), not just "saturated"
  or "idle" — otherwise it cannot see this failure class.
- Decision made in response: own the autoscaler in the fork rather than tune the
  upstream module further — see [[project_directus_issue455_fork_autoscale]].
