---
name: project_directus_pm2_autoscale_ramp_measured
description: Measured pm2-autoscale ramp on the planner — min_seconds_to_add_worker is a floor, not the period; the 50%-threshold measurement below is SUPERSEDED (caused a prod ratchet), see project_directus_pm2_autoscale_threshold_ratchet
metadata:
  type: project
---

**Superseded, do not re-apply the "how to apply" values below.** Threshold 50 /
cooldown 3 caused a real prod runaway on 2026-09-08 —
[[project_directus_pm2_autoscale_threshold_ratchet]]. Current prod config: threshold
**60** (reverted), cooldown left at **10 via a Railway variable** (files still say 3 —
deliberate, known drift, jean's call to reconcile later). The argon2-hashing smoke load
below pins every worker near 100% CPU, which **cannot** expose a threshold that sits
*inside* a worker's normal operating range — that blind spot is exactly what let 50%
ship. Treat any threshold change as needing validation against real traffic, not this
harness.

`PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER` is a **floor between adds, not the period**.
Each add also pays the new worker's boot (~3.3 s to listening) plus the module's 1 s
sampling tick before the pool can cross `scale_cpu_threshold` again, so real spacing is
roughly **cooldown + 4.5 s**.

Measured on dev (2026-09-08, `apps/domain/tests/smoke/pm2-autoscale-load.smoke.spec.ts`
against api.dev, threshold 50, max_workers 4, PM2_INSTANCES=1):

| cooldown | first fork | spacing | 1 -> 4 |
|---|---|---|---|
| 3 s  | 0.9 s | **7 s**  | 14.9 s |
| 10 s | 2.5 s | **15 s** | ~32 s (extrapolated from 2 forks) |

Extrapolated to prod's ceiling, 1 -> 8 workers is **~43 s at 3 s** and ~92 s at 10 s.
Load in that run: 8 concurrent `/utils/hash/generate`, 70.4 rps, 6343 served, 0 throttled,
0 failed, p50 103 ms / p99 248 ms.

**Why it matters:** the whole point of the 3 s value is to let `PM2_INSTANCES` drop to 1
at night — the autoscaler's floor is `defaultWorkersCount`, so at 2 the pool can never
release below 2. A single worker then absorbs the first **~7 s** of a spike, not ~3.

**How to apply:**
- Never quote the cooldown as the ramp; multiply by the measured spacing — but re-measure
  before trusting any number here, this run's own threshold choice caused an incident.
- `PM2_INSTANCES` is now `1` in the **base** `.env` (a9f3eff6, no longer a dev-only
  override) — see [[reference_planner_readenv_precedence]] for why a Railway override
  still wins over it.
- Only Api runs pm2 ([[project_directus_planner_bo_no_pm2]]); worker boot cost is
  [[project_directus_boot_cost_shape]] — fork→listening is ~3.26s (~0.8s process spawn +
  ~2.5s Directus extension load), distinct from container boot (dev 2.69s / prod 5.48s).
