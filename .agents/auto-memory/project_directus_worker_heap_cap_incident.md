---
name: project_directus_worker_heap_cap_incident
description: 2026-09-08 prod outage — --max-old-space-size=1024 on Api workers caused V8 aborts and a crash loop the autoscaler amplified to 32 workers.
metadata:
  type: project
---

**Never cap `--max-old-space-size` on the planner's Api workers.** Prod ran
`node_args: --max-semi-space-size=2 --max-old-space-size=1024` (merged `b9eafb6c`,
deployed `ae6f55464` 2026-09-08 03:02 UTC). Under morning traffic:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
App [api:68] exited with code [0] via signal [SIGABRT]   → restart, continuously
```

The planner's deep relational reads (`fields=` trees 20+ paths deep, `limit=-1`) pass
1 GB in a single worker.

**The amplifier is the part worth remembering.** Every abort pays a full boot, which is
~87% module loading and CPU-heavy ([[project_directus_boot_cost_shape]]). That CPU is
what `pm2-autoscale` samples, so it adds a worker, which boots, which adds CPU — from
`PM2_INSTANCES=1` the pool walked to its 32 ceiling on demand that was entirely its own
restarts. A crash loop and an aggressive ramp
([[project_directus_pm2_autoscale_ramp_measured]]) compose into a runaway.

**Why the measurement did not catch it:** RSS 371 -> 293 MB and "512 read ~8% slower,
1024 cost nothing measurable" were *steady-state throughput and RSS* under a synthetic
load. A cap is only safe at a **peak** someone has measured, and the peak was never
measured. `--max-semi-space-size=2` is the flag that recovers the RSS and it bounds new
space, not the heap — keep it, drop the old-space cap.

**How to apply:**
- `PM2_MAX_MEMORY_RESTART=2G` is the right backstop for a worker that grows: it recycles
  gracefully rather than aborting mid-request.
- **A Railway `NODE_OPTIONS` cannot lift a `node_args` cap** — pm2 passes node_args on the
  command line and the command line beats NODE_OPTIONS for conflicting flags. Only a
  deploy fixes it.
- Diagnose with `railway logs -e production -s Api -n 5000 --filter "FATAL ERROR"` and
  `--filter SIGABRT`; rising `App [api:N]` ids are the restart counter, not live workers.
- Fixed on develop by `aa31aee0`. Any change that reintroduces an old-space cap by
  another route (env chain, NODE_OPTIONS) reintroduces this outage — PR #753 moves these
  flags into the env chain and must not carry the cap.
