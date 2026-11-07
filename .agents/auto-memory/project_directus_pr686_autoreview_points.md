---
name: project_directus_pr686_autoreview_points
description: PR #686 (batched nested M2O/A2O writes, part C of #414) autoreview state — fixed items, the preserveMutationOrder flip (#694), and rulings Q2/Q3/D still open with probed outcomes
metadata:
  author: Jean Claveau
  type: project
---

Autoreview of #686 done 2026-11-06, not merged. Fixed + tested: key-only dedupe (second
empty `items.update` filter), unbounded `push(...)` (#397) + A2O quadratic copy,
JSON.stringify in A2O reasons, cancelled-row `[rowIndex]` vs `[index]` alignment test.

**Ruled 2026-11-07:** the default flips to `preserveMutationOrder`, own PR before #686: #694
(`Refs #689`). The flip alone settles nothing in #686: `saveNestedRecords` walks relation by
relation and ignores `mutationBatching`, so A, B and Q probe identically in both modes.

**Open — jean must rule, no #686 code until then** (outcomes probed 2026-11-07 on #686's
`40f04fc3bd`, real sqlite with `PRAGMA foreign_keys=ON`; Postgres not run):
- Q2: under `preserveMutationOrder`, walk per related collection (cut when a record flips
  between data and key-only) vs strict payload order. Row 1 `board`, row 2 `owner` naming that
  board: now 400 INVALID_FOREIGN_KEY, per collection 400, strict 200 but one `upsertMany` per
  nested record (100 rows, 2 relations: 200 vs 2). Rec: per collection.
- Q3: A and B stay documented limits of `minimizeMutations`, or generate two groups there too.
  A (key named alone by row 2's `owner`, written by row 1's `reviewer`): now 400
  NOT_NULL_VIOLATION. B (hook takes row 0's `{id:7,name}` over as 9, row 1's key-only `{id:7}`):
  now 400 INVALID_FOREIGN_KEY once an FK is enforced, dangling only without one. Rec: drop two
  groups; the default fixes both through the walk.
- D: `sameRowAs` twin files the nested revision under the last row, whose own record was
  dropped; fix = set the payload index only if absent. Rec: first row.

Bounds left in PR risks: C (case-insensitive collation), E (deleted allowed collection →
TypeError, predates), F nit. Pending question: fix `pr-autoreview` skill step-4 template to the
repo-Gherkin shape. Next after rulings: #691 codecov/patch 93.30% → 95%.

Related: [[feedback_use_case_gherkin_looks_like_repo_tests]],
[[project_directus_local_gate_noise]], [[project_directus_batched_plumbing_design]].
