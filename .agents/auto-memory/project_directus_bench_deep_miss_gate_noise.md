---
name: project_directus_bench_deep_miss_gate_noise
description: Bench/cache red on "deep: scoped MISS vs full-mode MISS" (ceiling 1.40) is timing noise; blocking only because the diff touches api/src/**/*cache*; rerun first, ceiling bump is jean's call
metadata:
  author: Jean Claveau
  type: project
---

Gate `shapes.deep.ceilings.missVsFull = 1.40` (tests/perf/cache.perf.test.ts:~292) sits at the noise edge: measured 1.23 (trunk), 1.39 (#614), 1.44 (#616, red). Scoped÷no-cache is steady 1.45-1.49x; the full-mode arm is what jitters (fast runner → ratio up).

**Blocking rule:** `bench.yml` makes a breach blocking iff the diff touches `api/src/**/*cache*`; otherwise advisory. So a flush-path-only PR (#616, `cache.ts`) goes red on noise.

**How to apply:** red Bench with only that gate over and every Redis count/KB gate green → `gh run rerun <run> --failed` before investigating. Note the run's `headSha` shows trunk but the job measures the PR head. Options if recurring (jean's design call, not done): A raise missVsFull to 1.45; B gate deep MISS on scoped÷no-cache (~1.47). Related: [[project_directus_bench_measures_trunk]], [[project_directus_ci_runner_saturation_prebuilds_benchmark]] (not the cause here: job started 9 s after creation).
