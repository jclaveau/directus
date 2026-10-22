---
name: project_directus_worker_ram_shape
description: What a Directus worker's RAM is actually made of — measured idle heap, the RSS high-water under load, and which parts do NOT grow with the project
metadata:
  author: Jean Claveau
  type: project
---

Measured 2026-09-08 on the fork's `api/dist`, planner-shaped schema (37 collections,
327 fields, 95 relations, 115 permissions), postgres, redis, no extensions,
`SERVE_APP=false`. Numbers are post-`global.gc()`.

- **Idle after boot: heapUsed 85 MB, RSS 238 MB.**
- **After 1000 mixed authenticated reads: RSS 371 MB while heapUsed stayed 82 MB.**
  RSS is a high-water mark of *transient* allocation, not of live data — nothing
  leaked. The dev deployment reports RSS 372 MB / heapUsed 185 MB, so the harness
  reproduces production's shape.
- **~64% of the idle heap is module text and bytecode**: 34.8 MB of `string` nodes
  (retained script sources) plus 20.5 MB of `code` in the snapshot, against 22.5 MB
  of source actually loaded across 4920 files. Cutting imports cuts RAM roughly 1 MB
  of heap per 0.6 MB of source dropped.
- **The schema is NOT the cost.** `getSchema()`'s `SchemaOverview` for this project
  is ~2 MB (idle 85.5 → 87.6 after a REST read + `/fields`). Same conclusion as
  [[project_directus_boot_cost_shape]] reached for boot time.
- The permissions local LRU is capped (`maxKeys: 100`, `api/src/permissions/cache.ts`)
  and is not a growth path.

**Why:** every plausible "it must be the schema / it must be a leak" theory was
measured and refuted. The two things that actually move a worker are *which modules
got imported* and *how V8 is configured*, not the size of the project.

**How to apply:** multiply any per-worker saving by `PM2_AUTOSCALE_MAX_WORKERS`
(32 on the planner's Api). See [[project_directus_ram_node_flags]],
[[project_directus_eager_module_imports]], [[reference_directus_ram_probe_harness]].
