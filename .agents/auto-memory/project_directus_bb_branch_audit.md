---
name: project_directus_bb_branch_audit
description: Blackbox branch audit (PR #769) — how to place bb-unit-only / bb-out-of-scope tags; gaps never fail it, a tag on code blackbox fully runs does
metadata:
  author: Jean Claveau
  type: project
---

`tests/blackbox/branch-audit/branch-audit.mjs` (split out of #749 into #769, 2026-11-25);
tag syntax and exit rules are in its header. What the header does not say:

- Tag from coverage, not from guesses: gaps are only reported, while a tag whose code
  blackbox runs in full FAILS ("drop the tag"). Push, read the report (or pull the CI
  blackbox + unit coverage), then tag exactly what is unrun.
- A whole-function tag ends the line holding the body `{` (fnMap `loc` start).
- `// bb-unit-only:` also needs the api unit tests to run every counter it covers.
- CLI coverage (`dumpCoverageAtExit`): a bb command always runs instrumented with
  `COVERAGE_DIR` set, and `renameSync` runs after the dump read the hit counters, so
  those lines are unit-only.

- Any comment quoting the literal `// bb-out-of-scope:` is read as a tag and fails
  with "names no issue" (a stale docblock did, 61750b5eb6). Reword prose about tags.
- Drift check (e2f9a7cf43): each `OUT_OF_SCOPE_FEATURE_ISSUES` issue needs a tag (named `OUT_OF_SCOPE_FEATURES`
  until 2a0f103fac), a tag
  naming a feature needs its issue, entries stay plain `'<feature>': '#<issue>',` lines.
- A scenario that reaches a tagged line removes the tag, restoring the exact line of
  the base branch, so it leaves the patch (25 removed in d5778b1996).
- Appending a tag adds the upstream line to the diff: the style gate ignores tag-only
  changes (477a0f48d1); codecov/patch and CodeQL still count it
  ([[project_directus_codecov_aggregate_patch_gate]]).

**Why:** #769's first audit run listed 6 unrun lines; tagging the 4 code lines gave 0 gaps.

**How to apply:** adding or sweeping tags. jean asked 2026-11-25 to flag in #769 every
logic branch known as oos (from the dedicated issues, [[feedback_directus_oos_feature_gathered_issue]])
or unit-only, each with its inline comment — check the PR for how far that got.
