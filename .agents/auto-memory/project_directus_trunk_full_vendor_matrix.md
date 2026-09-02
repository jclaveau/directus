---
name: project_directus_trunk_full_vendor_matrix
description: A PR's blackbox is the postgres smoke set while a push to trunk runs sqlite3 + postgres + maria, so a green PR does not prove trunk green for anything dialect-sensitive
metadata:
  type: project
---

`blackbox.yml` picks the vendor matrix by event:

- **PR** with `Run Blackbox` → `["postgres"]`.
- **`Run Blackbox Full`** → `["sqlite3","postgres","maria"]`.
- A **push to `v11.10.1-hhh-dev` does not run blackbox at all** — measured: that branch's
  last `blackbox-pr.yml` runs are `pull_request` events from June, all skipped. Trunk CI
  is lint + unit.
- A `ci-dialect-*` branch runs unconditionally on the one vendor its `.github/ci-dialect`
  file names.

So merging a green PR is the first time SQLite and MariaDB see the change. The red does
not surface on the trunk run itself — that one only carries `Check` (lint + unit). The
trunk push runs `Refresh dialect CI branches`, which pushes onto `ci-dialect-sqlite3` and
`ci-dialect-maria`, and *those* branches' own `Check` runs are the ones that go red.
Read them by branch, not by the trunk SHA.

**Why:** #421 changed the migration runner's transaction behaviour per dialect. The PR
was green on the postgres smoke set while every SQLite and MariaDB claim in it rested on
local probes and reasoning. Anything conditioned on `getDatabaseClient`, on transactional
DDL, or on a dialect helper is in this category.

**Confirmed on merge of #421:** trunk `5ee7b4d9b0` was green, and both dialect branches
picked up a brand-new failing shard 7 —
`tests/db/database/migration-transaction.test.ts` listed `sqlite3` among the
transactional engines while `run.ts` wraps only `postgres`/`cockroachdb`, so the
rolled-back probe table and its version row both survived on sqlite3 and maria, and the
leftover `directus_migrations` row then made the success case skip its own migration.

**How to apply:** a red `ci-dialect-sqlite3` / `ci-dialect-maria` is **not** a merge
blocker and not work to schedule — those two are out of scope
([[feedback_directus_pg_only_dialect_focus]]), and both branches were already red on
unrelated shards before #421. Do not ask for `Run Blackbox Full` before merge on their
account. Read them only to know which dialect claims in a PR body are unproven, and say
so there instead of chasing the red. Watch the merge-push run itself
([[feedback_watch_merge_push_run_not_dispatch]]) — that one does gate.
