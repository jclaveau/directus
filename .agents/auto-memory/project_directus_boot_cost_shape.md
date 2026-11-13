---
name: project_directus_boot_cost_shape
description: What a Directus worker's startup is actually made of — ~87% module loading, a negligible schema cost, and extensions that dwarf both
metadata:
  author: Jean Claveau
  type: project
---

Measured on the fork, 2026-09. A worker's time from spawn to its first answered
`/server/ping`:

- **Module loading is ~87% of it.** Before the optimisations: 5004 modules, 14853
  `resolve()` calls, 22.7 MB of source parsed, and ~4.4 s of a 4.9 s boot elapsed
  *before the first log line*. CPU profile self-time was 71% `node:internal`, with
  `get exports @ package_json_reader` the top frame at 1274 ms.
- **The schema barely matters.** `getSchema()` goes 30 ms → 42 ms between a
  bootstrap-fresh database and a consumer's (31→67 collections, 354→670 fields).
  Sub-linear, ~0.5% of a boot. Init does *not* scale with the project.
- **Extensions dominate what is left.** A consumer's 9 loading extensions take init
  from 172 ms to 2690 ms (#442).

Three merged changes took it 3243 ms → 1857 ms (−42.7%): #434 (no upstream call on
boot), #440 (`module.enableCompileCache()`), #435 (per-function imports).

**Why:** every one of these was measured, and two plausible-sounding ideas were
refuted — bundling the API's own code is worth nothing (518 dist files → 32 measured as
noise, and it breaks three runtime path derivations), and the init phase was *assumed*
to be the thing that grows with the project until it was measured and wasn't.

**How to apply:** boot work belongs in module loading or extensions, not in
`getSchema`. A repetition is one worker and PM2 starts them serially, so multiply any
per-worker saving by the scale step. See [[project_directus_startup_bench]] for the
instrument (the PM2 shape is in the consumer repo's memories).
