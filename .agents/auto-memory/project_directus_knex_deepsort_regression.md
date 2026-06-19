---
name: directus-knex-deepsort-regression
description:
  Directus is incompatible with knex >= 3.2.10 (PR #6392) — it double-escapes the rowNumber window alias
  and 500s every deep o2m/m2m/m2a sort on all dialects; the fork pins knex 3.1.0
metadata:
  type: project
---

Bumping knex past 3.1.0 in this Directus fork breaks **deep relational sort**.

**Why:** knex 3.2.10 (PR [#6392](https://github.com/knex/knex/pull/6392), "Properly Escape Aliases in Analytic
Functions") now wraps window-function aliases via `formatter.wrap`. Directus pre-wraps its `directus_row_number` alias
with `knex.ref('directus_row_number').toQuery()` in `api/src/database/run-ast/lib/get-db-query.ts:205` (the
`hasMultiRelationalSort` path). So 3.2.x double-escapes it → `... as ""directus_row_number""` → invalid SQL → **HTTP 500
on every nested o2m/m2m/m2a sort, all dialects**.

- Symptom in blackbox: `m2m/o2m/m2a.test.ts` `AssertionError: expected 500 to deeply equal 200`, only in the sort
  describe-blocks ("without limit", "sort depth limit"). Simple sorts/CRUD pass.
- Caught it during PR #48 (#35 drop-index): the PR had bumped knex 3.1.0→3.2.10 for native `table.dropUniqueIfExists`.
  Reverted the bump and hand-rolled the conditional drop instead.

**How to apply:**

- Keep `knex: 3.1.0` in `pnpm-workspace.yaml`. Do NOT bump to 3.2.x without first patching `get-db-query.ts:205` to pass
  the bare `'directus_row_number'` (valid unquoted on old knex, wrapped on new).
- That alias double-escape is a **latent upstream Directus bug** — worth filing/PR'ing upstream independently (option D,
  not yet done).
- For the #35 conditional drops without native knex: base `dropUniqueIfExists` = raw
  `ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??` (pg/cockroach/mssql 2016+), sqlite overrides with `DROP INDEX IF EXISTS`
  (uniques are indexes), mysql/oracle keep catalog checks.

Related: [[directus-fork-integration-branches]], [[directus-db-clients-and-returning-support]], [[knex-drop-if-exists]].
