---
name: project_directus_coverage_bb_vs_unit_split
description: How to tell a coverage line blackbox can still reach from one only a unit test can credit on this fork, and why the blackbox ceiling is far below the 95% patch gate
metadata:
  type: project
---

The blocking `codecov/patch` (95%, see [[project_directus_codecov_aggregate_patch_gate]])
blends the `blackbox` and `api` flags. Before writing any test, split the uncovered
lines by **which suite can move them**, using per-flag line coverage:

```
https://api.codecov.io/api/v2/github/jclaveau/repos/directus/report/?sha=<40-char>&path=<urlencoded>&flag=blackbox
```

Classify each uncovered added line by its entry in the `blackbox` report:

- **no entry at all** → the bundled instrumented build's sourcemap cannot attribute it.
  Only a unit test credits it. These are the wrapper lines of multi-line statements —
  signatures, `}`, `else`, multi-line ternaries and arrow params — and the 85-column
  style makes almost every statement multi-line.
- **entry = miss** → a real path blackbox reaches and never takes. A new bb test works.
- **entry = partial** → branch half-taken; bb can take the other arm.

**Measured on #402 (2026-08-31):** 148 uncovered lines split 106 unit-only / 42
bb-coverable. Writing the reachable bb scenarios moved the gate **+0.90pp**; the unit
pass moved it **+11.19pp** (83.95% → 95.14%). Covering a bb path credits fewer lines than
it executes, so bb work is for behaviour, not for the number.

**The two big wins were functions with NO unit test at all** —
`pinnedScopedCacheTagsFromO2mChildren` (plus `scopedCacheRowsAtPathEnd` /
`scopedCacheCollectionAtPathEnd`) and `stripInjectedOwnershipNesting`. Both were well
covered by blackbox and still read as uncovered. Grep for an exported function with no
`describe` before assuming the gap is exotic.

Related: [[reference_codecov_line_coverage_api]], [[feedback_integration_first_unit_fills_gaps]].
