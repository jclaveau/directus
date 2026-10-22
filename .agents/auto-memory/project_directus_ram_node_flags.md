---
name: project_directus_ram_node_flags
description: The V8/malloc flags that actually cut a Directus worker's RSS, and the ones that measurably do not — --max-old-space-size CAUSED A PROD OUTAGE, do not re-add it
metadata:
  author: Jean Claveau
  type: project
---

**`--max-old-space-size=1024` caused a real prod outage 2026-09-08** — see
[[project_directus_worker_heap_cap_incident]]. Steady-state RSS/throughput measurement
below is real but does not prove a cap is safe: a prod consumer's deep relational reads
(`limit=-1`, 20+-path `fields=`) pass 1 GB in a single worker under real traffic, V8
aborts (SIGABRT), pm2 restarts, and the restart CPU feeds the autoscaler into a runaway.
**Only `--max-semi-space-size=2` shipped in the end; the old-space cap was reverted and
must not come back** by any route (`node_args`, `NODE_OPTIONS`, env chain).

Same harness as [[project_directus_worker_ram_shape]], 1000 requests per arm.

| arm | RSS idle | RSS after load | 1000 reqs |
| --- | --- | --- | --- |
| default flags | 238 MB | **371 MB** | 19.3 s |
| `--max-semi-space-size=2 --max-old-space-size=1024` | 211 MB | **293 MB** | 22.0 s |

With the eager-import fixes of [[project_directus_eager_module_imports]] on top:
170 MB idle → **243 MB** after load, 21.7 s. So flags alone are ‑78 MB and the pair
is **371 → 243 MB (‑34%)** per worker — ~4 GB across 32 workers.

- `--max-semi-space-size=2` is the big one: it takes `heapTotal` from ~106 to ~81 MB
  and most of the post-load RSS with it. New space defaults to 16 MB × 3 on a large
  heap and the API allocates almost entirely short-lived objects.
- `--max-old-space-size` is a *cap*, worth ~6 MB on its own; 1024 costs nothing
  measurable while 512 read ~8% slower on one run. Prefer 1024 unless a worker is
  proven to stay far below it — batch imports/exports are what would blow it.
- **Measurably useless here:** `--v8-pool-size=2` (RSS went *up* 12 MB),
  `MALLOC_ARENA_MAX=2` (‑3 MB idle, ‑7 MB loaded), `MALLOC_TRIM_THRESHOLD_` (nothing).
- The 1000-request timings span 19.3–23.1 s across arms, which is the noise band, so
  read "no measurable throughput cost", not "free". A real load test is still owed.

**How to apply:** only ship `--max-semi-space-size=2`. Never set `--max-old-space-size`
on Api workers without a **measured peak** under real (not synthetic) consumer traffic —
steady-state RSS/throughput numbers like the ones above do not substitute for one.
