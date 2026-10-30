---
name: project_directus_pr494_proportional_release
description: Issue #457/PR #494 — autoscaler releases toward a mid-band target (geometric halving) instead of one worker per cooldown; settled design points and the one decide-case that isn't blackbox-pinnable
metadata:
  author: Jean Claveau
  type: project
---

**Rule** (`api/src/processes/autoscale/lib/decide.ts`): `midBandSize(cpuPercents,
config)` — the smallest pool whose projected average sits at or under
`(releaseCpuThreshold + scaleCpuThreshold) / 2`, never under `minWorkers`.
Release count `= Math.ceil((workers - target) / 2)` (half the distance,
rounded up) — a pool halves toward the target each cooldown: 32→16→8→4→2→1 for
an idle pool. Mid-band, not either edge: released to the release edge it
releases again on the next dip; released to the scale edge it buys the worker
back on the next rise. Bounds/freeze/pending-warming holds and the release gate
(`averageOver(cpuPercents, workers-1) < releaseCpuThreshold`) are unchanged —
`midBandSize` only picks the target once the gate has already said "release".

**Loop** (`index.ts` `releaseWorkers`): issues every `releaseWorker(pmId)`
concurrently via `Promise.allSettled`, rethrows the first rejection only after
all have settled — drains overlap, the tick waits for the slowest, a refused
release doesn't cancel its siblings.

**Settled review points (don't re-raise):**
- The `Math.max(1, …)` clamp on the release count was dead code (gate arithmetic
  already guarantees `ceil(≥0.5) = 1`) — removed, not weakened.
- Reason string says "across all but one worker", not "across the N worker(s)" —
  the gate reads `workers - 1`, and the old phrasing implied the WRONG worker
  count.
- `allSettled` dropping sibling rejections (keeping only the first) is accepted:
  every timeout carries identical text, so nothing informative is lost.

**Not blackbox-pinnable: the mid-band-vs-edge target case.** `midBandSize` is an
integer off a *rounded* average of a duty-cycle CPU fixture on a shared runner —
a release-edge, mid-band and scale-edge target can differ by exactly one worker,
which a real reading's noise erases. Simulated three candidate bb arms before
building any of them (band 50/70 too tight, 45/65 window `[45,85)` only
distinguishes the whole-step mutant, band 10/90 withdrawn after simulation
showed the gate never firing under noise) — landed on unit tests only for that
case, with a comment naming the gap. **Lesson: simulate a blackbox arm's
reading window against the fixture's actual noise band before writing it**, not
after it flakes in CI.

Merge blocked twice by unrelated blackbox failures, not this PR's code — see
[[project_directus_bus_subscribe_race_pr497]] (the real cause) and
[[project_directus_bench_workflow_traps]] (resident-bench-on-a-stale-branch,
fixed by merging trunk in). Filed [[project_directus_issue495_release_bound]]
as a disclosed, not-fixed, side effect: a release of several is a release of
several chances to hit the supervisor's 15s bound.

`minSecondsToScaleDown` default changed 300 → 120 (`api/src/processes/autoscale/lib/sanitize-config.ts:17`,
the figure #457 names), 2026-09-16, jean's explicit call after prod showed
release actually happening 60-90s after an add. Only reader is
`resolve-config.ts`'s env fallback; no test/doc pinned 300. Prod/dev don't
hit this default anyway — the consumer's own env sets `RELEASE_WORKER=60`.
Pushed as its own commit onto #494 (5 commits total), PR body Scope updated
in the same command that re-fetched it.

MERGED 2026-09-16 as trunk `50c5008cda` (head `daa9444cd7`, 6 commits, all
checks green incl. 8/8 bb shards). Closes #457.
