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
(`Refs #689`), merged d2a0022175. `saveNestedRecords` walks relation by relation and ignores
`mutationBatching`, so A, B and Q probe identically in both modes. But the nested upserts it
calls take the new default, so statement order DOES change.

**Merging #694 into #686 (2026-11-07), 3 red in `items.test.ts`:** local unpushed ef469620df in
the batched-m2o-a2o worktree. "writes the countries of every created row in one upsert" goes
from one batched insert to insert/update/insert; "upserts the items..." update after insert;
"files the revision of each country..." parents now keys 1→3, 2→4. Awaiting jean: accept the
payload order, or have nested writes pass `minimizeMutations`.

**Q2 went further (2026-11-07):** jean's point: the question is which collection goes first.
Design = merge relations by target collection, write referenced collections first (FK graph
from `schema.relations`, not the query tree: a scalar FK is invisible there, and an O2M leaf
goes after its root), field order inside a cycle, cut on data/key-only flips under preserve.
Prototype probed on `40f04fc3bd`, sqlite + FKs on, not on the branch; patch was throwaway. All
432 of items + payload suites green, once duplicate relation entries of one field were deduped
(a test schema has them; a merged walk would upsert one record twice).

Outcomes with the prototype, both modes unless noted: Q 200 (was 400); S board, person, card;
A 200 (was 400); key-only named BEFORE its data, across rows or in one row, 400 NOT_NULL like
raw SQL; same key with data twice, last wins; B minimize 400 FK, preserve 200 (`b-1`→held,
`b-2`→created with null name); schema FK cycle 400.

**Open — jean must rule, no #686 code until then:**
- FK order: ruled 2026-11-08 by jean: apply on #686, tests first (session bbbfcd2c).
  - Tests 44e85109d6 (pushed): items.test.ts, sqlite with FKs on, describe "the nested M2O
    rows a foreign key orders": Q, A, and B under the default preserve mode.
  - Port 4556287329 (local until CI shows the tests red):
    `resolveMutationBatching(opts ?? {})` replaces `!== 'preserveMutationOrder'`; key-only
    also requires a non-missing key, so `{ id: null }` is a create; `upsertRowIndexes` →
    `upsertReferences`; type `NestedReference`.
  - Open for jean, in a choice block: gap 1, the merged upsert passes
    `nested: [...this.nested, references[0].field]`, so a validation error on a reviewer
    record reports path ['owner']; a fix plumbs a per-record path through upsertMany →
    createMany/updateGroups → processPayload. And **challenge `minimizeMutations` before
    merge** (jean): on B it returns 400 FK = raw SQL; preserve's 200 is not clean (board 7
    never existed, a hook swapped row 1 to board 9; row 2 then creates empty
    `{id:7,name:null}`, passing only because `name` is nullable).
  - A2O: still processA2O's own pass, after the M2O records; goes through
    saveNestedReferences, so preserve segmenting applies; not ordered against the M2O
    collections. Stated in the processM2O docblock.
  - Probe files in `tmp/fk-order-686*` (untracked): delete once the port merges.
- Q3 redone: A stops being a limit. Two groups in minimize now only changes B (400→200,
  predicted) and key-only-before-data (400→200, predicted, looser than raw SQL). Rec: drop.
- D: `sameRowAs` twin files the nested revision under the last row, whose own record was
  dropped; fix = set the payload index only if absent. Rec: first row.

Bounds left in PR risks: C (case-insensitive collation), E (deleted allowed collection →
TypeError, predates), F nit. Pending question: fix `pr-autoreview` skill step-4 template to the
repo-Gherkin shape. Next after rulings: #691 codecov/patch 93.30% → 95%.

Related: [[feedback_use_case_gherkin_looks_like_repo_tests]],
[[project_directus_local_gate_noise]], [[project_directus_batched_plumbing_design]].
