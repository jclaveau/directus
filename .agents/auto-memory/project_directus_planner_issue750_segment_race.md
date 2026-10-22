---
name: project_directus_planner_issue750_segment_race
description: Planner issue #750 — addCourses segment-race retry retired but its two guard tests left behind, now commented pending an uncomment-vs-delete decision
metadata:
  type: project
---

`c0b2ecd2 chore(studying): retire the addCourses segment-race retry, kept
commented` (2026-09-03, on both `develop` and `main`) commented out the retry
loop in `add-courses.ts:121-166` but left the two unit tests in
`src/studying/front/add-courses.unit.spec.ts` that assert it — they started
failing e2e-back on any PR that got past `bail: 1` far enough to reach them
(first hit while merging deploy PR #749). Commented the two tests in place
next to the loop they describe (`a5fb19d8`), with a note that they move *with*
the retry, never alone; the block's third test
(`rethrows a unique violation raised by any other collection`) stays live —
it already describes post-retirement behavior.

Filed as **https://github.com/the-HipHipHip/Planner/issues/750**, recording
the retirement's own rationale (constraint violated once on a preview
2026-08-29, never since; the hooks that likely rode the race now take the
mutation's connection — #742) and both resolution paths: delete the two tests
for good, or restore the retry implementation if commenting it out was only a
park. Decision is jean's, unresolved as of this handoff.

**Why it stayed invisible so long:** two blind spots the incident exposed —
`apps/domain`'s `package.json` exposes a `test` script, not `test:unit`, so
the CI "Unit Front" job (`pnpm test:unit`) never runs this file at all; and
e2e-back's `bail: 1` stops the whole 24-file run at the first red, so the
other ~6 files never report pass or fail either. `main` has been red since
the same 2026-09-03 day on an unrelated test
(`enroll-preserves-cursus-segments > Re-adding a segment a discipline already
has purges that discipline's slice alone`) — that one is untouched and still
open, separate from #750.

**How to apply:** don't re-diagnose this as a fork-bump regression if it
resurfaces — it predates the bump on both branches. Before trusting an
"all green" from apps/domain, check whether the relevant spec is inside the
`test` (full) run or would need `test:unit` scoping, and whether `bail`
suppressed files after the first failure.
