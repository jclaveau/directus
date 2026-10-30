---
name: project_directus_startup_bench
description: The startup benchmark — tests/perf/*.perf.test.ts, dispatch or after Check, and why it reports a PAIR of arms rather than a number
metadata:
  author: Jean Claveau
  type: project
---

`tests/perf/` holds `*.perf.test.ts` benchmarks; `startup.perf.test.ts` is the only
one so far. `.github/workflows/bench.yml` runs it.

Design decisions that are load-bearing, not taste:

- **It measures `dist/`** — the bundle `pnpm --filter directus deploy` produces, which
  the blackbox suite runs and production starts. Not the workspace build.
- **Every repetition is a cold boot in its own cache namespace.** A warm cache skips
  the build-identity flush, and that path alone pulls ~480 modules
  (`@redis/client` + axios), which swamps any code change. Two arms measured in
  different cache states compare nothing — this confound turned a real `+2` into a
  bogus `−558` before it was caught.
- **Two arms per run, alternating.** A shared runner's absolute number belongs to the
  runner: the same bundle measured 4.5 s and 6.5 s on one laptop, and GitHub's runner
  is *faster* than the laptop (1.9 s vs 3.4 s). Only the ratio is the product.
- **Noise floor ≈1% at 7 reps** (A/A: +1.0%, +0.1% on the laptop, −1.2% and −0.7% on
  runners). At 3 reps it was 2.3%, which is why 7 is the default.

Triggers: `workflow_run` after **Check** on a push, plus `workflow_dispatch` taking
`ref`, `baseline` and `reps`. Results go to the job summary, an artifact
`bench-startup-<sha>`, and a `Bench / startup` commit status.

**How to apply:** never quote an absolute startup number across runs; quote the pair.
`PERF_CLI` / `PERF_CLI_BASELINE` point the arms at bundles built elsewhere.
See [[project_directus_boot_cost_shape]] and [[project_directus_bench_workflow_traps]].
