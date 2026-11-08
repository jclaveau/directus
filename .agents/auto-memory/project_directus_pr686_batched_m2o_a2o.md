---
name: project_directus_pr686_batched_m2o_a2o
description: PR #686 batched nested M2O/A2O writes - settled review points, the lock it takes, and how a mutant can stop the blackbox seeds
metadata:
  type: project
---

Autoreview of #686 (2026-11-07), head 28bf2f874c.

- Accepted, documented in the PR risks: a key compared by its spelling (char(n), citext), payload order not kept across relations or A2O collections. MariaDB `_ci` is #610 point 20.
- Settled by jean (B in #686): `upsertRun` takes `FOR NO KEY UPDATE` on Postgres, `FOR UPDATE` on MariaDB and CockroachDB (`supportsNoKeyUpdateLock`). A foreign key no longer waits on a row the run updates; a delete still does. Read from the lock conflict table, tests pin the SQL only.
- Settled by jean (C in #686, b11ece8dc5): a run whose payloads write a field with `inUniqueIndex` (flag added to the Postgres schema overview, `in_unique_index`; unique, non-primary, non-partial, non-expression indexes) reads `FOR UPDATE`, else `FOR NO KEY UPDATE`. Avoids the lock upgrade deadlock against a `FOR KEY SHARE`. A filter hook adding a unique column after the read keeps that window: accepted, in the PR risks. Third autoreview (36a106db87): the primary key field never counts as a unique column; INCLUDE columns over-flagged and partition-only unique indexes unflagged are documented, not fixed.
- Applied on jean's go (2026-11-08): processM2O writes one upsertMany per related collection, the referenced collection first (DFS over `schema.relations`, field order inside a cycle); under preserveMutationOrder `saveNestedReferences` cuts key-only from data records. Tests 44e85109d6 (red: FK, NOT NULL, FK), fix 4556287329. Still jean's choices: the validation `nested` path of a merged upsert names the first field only; case B (a hook takes over the record writing key 7, a later row names 7 alone) creates an empty board 7 under preserve, 400 FK under minimize.
- Added on jean's go: updateByQuery reads its keys with the caller's `emitEvents` (test 9d5f3e9b55 red, fix 164567274d), like deleteByQuery's 28e0aa6d92.

**Why:** #694 flipped the default to `preserveMutationOrder` after this branch was written: 3 tests and the PR body stayed true only under `minimizeMutations`. A branch older than #694 reads as `update · insert`; at the default it writes `insert · update · insert`.

**How to apply:** on a mutation push, keep a mutant that misfiles nested records out of the blackbox round: `rowIndexes[recordIndex]` in `saveNestedRecords` is the likely one of the mutants that failed seeding with a 500 on `directus_access` (4926 failed, unreadable). Run it through unit only, and the blackbox-only mutants in their own push. See [[project_directus_blackbox_flakes]].
