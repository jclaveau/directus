---
name: project_directus_pr686_batched_m2o_a2o
description: PR #686 batched nested M2O/A2O writes - settled review points, the lock it takes, and how a mutant can stop the blackbox seeds
metadata:
  type: project
---

Autoreview of #686 (2026-11-07), head 28bf2f874c.

- Accepted, documented in the PR risks: a key compared by its spelling (char(n), citext), payload order not kept across relations or A2O collections. MariaDB `_ci` is #610 point 20.
- Settled by jean (B in #686): `upsertRun` takes `FOR NO KEY UPDATE` on Postgres, `FOR UPDATE` on MariaDB and CockroachDB (`supportsNoKeyUpdateLock`). A foreign key no longer waits on a row the run updates; a delete still does. Read from the lock conflict table, tests pin the SQL only.

**Why:** #694 flipped the default to `preserveMutationOrder` after this branch was written: 3 tests and the PR body stayed true only under `minimizeMutations`. A branch older than #694 reads as `update · insert`; at the default it writes `insert · update · insert`.

**How to apply:** on a mutation push, keep a mutant that misfiles nested records out of the blackbox round: `rowIndexes[recordIndex]` in `saveNestedRecords` is the likely one of the mutants that failed seeding with a 500 on `directus_access` (4926 failed, unreadable). Run it through unit only, and the blackbox-only mutants in their own push. See [[project_directus_blackbox_flakes]].
