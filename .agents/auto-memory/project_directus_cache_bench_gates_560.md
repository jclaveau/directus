---
name: project_directus_cache_bench_gates_560
description: PR #562 (MERGED e44bdb90fa, issue #560) — cache bench command ceilings + server-CPU gates, workflow_dispatch `ref` for any commit, measured prod-pin comparison (bench does NOT reproduce the CPU rise); settled points, do not re-raise
metadata:
  author: Jean Claveau
  type: project
---

**What landed in `bench.yml` / `tests/perf/cache.perf.test.ts`:**
- Hard ceilings on Redis commands a scoped read ADDS over `off`: 2 hit / 7 fill / 7 fan
  fill, PLUS ratchets 15 fill / 900 fan fill (jean: "both, fix comes in next PR"). Trunk is
  known-red on the hard ones (8.98 fill, 809 fan fill after #534) until the fan-fill fix;
  commented on #560. `Bench / cache` is NOT a required check; making it one is jean's
  branch-protection call.
- Two counts per cell: **executed** (`INFO commandstats`, includes Lua-internal) vs **sent**
  (MONITOR, source ≠ `lua` and ≠ the bench's own addr). Scoped fan fill = ~820 executed but
  ~208 sent (203 EVALSHA). Gates stay on executed; the Api-CPU-relevant number is sent.
- CPU gate = fastest sample over `off`'s fastest (noise only adds time), 9 reps, arm order
  rotated per rep (`armsInRepOrder`), ceilings 1.85 fill / 1.85 fan fill / 1.35 hit.
  Median-of-paired-ratios was measured worse (1.57–2.52x on unchanged trunk) — declined.
- Blocking scope (advisory elsewhere): any non-test `api/src/**/*cache*`, `respond.ts`,
  `compress.ts`, the bench files. A dispatch with a `ref` ≠ its own head posts NO commit
  status (summary only). `persist-credentials: false` on all checkouts.
- `workflow_dispatch -f ref=<sha|branch|short sha> -f suite=all|startup|cache` builds the
  measured commit with ITS OWN Node/pnpm (from package.json `engines`/`packageManager`),
  pnpm 10 forced onto PATH and `PNPM_HOME` unset, and re-pins `rolldown-plugin-istanbul` in
  `pnpm-workspace.yaml` to the lockfile sha before `deploy` (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`).
  Needed 5 workflow fixes before an old commit built.

**Measured (ratios vs `off`, units always):** old prod pin `d38af828d5` scoped fan fill
2.19–2.27x, hit 6 cmds; current prod `514d416386` 1.32–1.73x, hit 1 cmd; #534 head
`db23e8c2a8` 1.40–1.53x, fill 13→9 cmds. Cache path got CHEAPER between the pins, so the
prod Api CPU doubling (a consumer deploy) is NOT in what this bench exercises; the per-row
fan-fill cost (~814 cmds) predates #438. Lead (1 run each, unconfirmed): `off` fan-fill CPU
3.8 ms → 5.9–6.1 ms between the pins.

**Traps:** a `workflow_run` bench is listed under the TRUNK sha, so poll the PR head's
statuses ([[project_directus_bench_workflow_traps]]); the status line quotes headlines,
not the breached gates ([[project_directus_bench_cache_status_misread]]); Headroom `observe`
rows print OVER but gate nothing.

Related: [[project_directus_cache_redis_db_559]].
