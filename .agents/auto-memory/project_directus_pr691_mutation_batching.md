---
name: project_directus_pr691_mutation_batching
description: PR #691 mutationBatching autoreview - disableBatching holds every action until the commit (jean chose it), purges hook takeovers on rollback, checks the limit before hooks
metadata:
  type: project
---

Under `disableBatching`, `createMany`, `updateGroups` and `upsertMany` fire their
actions after the commit, one per row, group or payload. jean chose this on
2026-11-07 over keeping them in the transaction: none for a rolled-back write, and a
hook writing the row through its own connection cannot wait on the row lock.

**Why:** a stale cache or a hook told about a rolled-back write outweighs matching
`updateBatch`'s old in-transaction order.

**How to apply:**
- Tests pinning the action between groups or payloads are wrong by design now.
- `preserveMutationOrder` and the default upsert still fire before the commit of a
  later run. Not part of the choice: report it, don't call it settled.
- `createRowByRow` keeps events of a retried attempt: non-PG, #610 point 15.
- `mutationBatching: undefined` in the SDK gives a 400 (`query-to-params.ts:106`).
  Predates the PR, not fixed.
