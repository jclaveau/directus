---
name: project_directus_issue636_batch_to_db_layer
description: Issue #636 — moving the update batch's postgres knowledge out of items.ts into the jclaveau/knex fork (PR #2 feat/batch-update) and db helpers; split rule, number-serialization ruling (A), knex PR #2 review state
metadata:
  author: Jean Claveau
  type: project
---

Follow-up of [[project_directus_pr634_update_groups_batch]] (merged 72edae70cc). Issue #636 (enhancement). Rule: what node-pg/postgres decides goes DOWN a layer; what Directus schema/permissions/hooks decide stays in `items.ts` ([[feedback_domain_stays_out_of_shared_layer]]).

**Moves down:** value serialization (Date→local+offset, bigint/NaN→String, undefined dropped) → knex pg json mode; `getDatabaseClient !== 'postgres'` → `capabilities.supportsJsonBatchUpdate()`; `BATCH_FIELD_TYPES` → `capabilities.jsonBatchUpdateTypes()`; `'23505'` → `isUniqueViolation(error)` beside `database/errors/dialects/postgres.ts`.
**Stays:** `splitBatchRuns`, preset/alias gate, 23505-only fallback + `{}` payload, `recordUpdatedRows`.

**Ruled (jean, 2026-10-25) — finite numbers: A.** knex json mode keeps JSON numbers (documented in knex docs + compiler comment); only an exponent-form number into a `text` column differs from `.update()` (`1e-7` vs `0.0000001`). Directus stringifies numbers for string-like types itself. B (stringify exponents) / C (`from_db`) rejected.

**Knex side** (`/home/jean/dev/knex`, branch `feat/batch-update`, PR #2 vs master; pin only ever to an `hhh-dev` commit): d4a8257c = `prepareBatch` drops a column undefined in every row, throws `TypeError` (names the column) if undefined in only some; pg json mode routes Date/bigint/NaN through node-pg `prepareValue`. Needs jean's go before the `--no-ff` merge into `hhh-dev` + Directus pin bump; the Directus PR is a separate ask.

**Gotchas:**
- Knex repo uses prettier (the Directus "no Prettier" rule doesn't apply there). `npm install --ignore-scripts` skips better-sqlite3's binding: rebuild only it, else 4 unit tests fail on env.
- Real-pg integration check: throwaway pg17 container on 25432, capped, removed after. cockroach `int` = int8 → node-pg reads `'1'`: don't select `id` in cross-dialect tests.
- Test TZ restore: `process.env.TZ = saved` with TZ unset stores the string `"undefined"` (=UTC) and leaks into later tests — `delete` instead, in try/finally.

**/pr-autoreview of knex#2 DONE (head 95e9073f, 548 checks green incl. cockroach; CodeQL red = upstream alert):** fixed+pushed (b5ffd6ba, 5df13345, 95e9073f, 9defa5ec): pg json `wrapIdentifier` (JSON keys via `customWrapIdentifier`), `chunkSize: NaN`, bigint in composite key (dedupe + `'throw'` message), TZ leak, rollback-test swallow, 2 docs claims. **19 choices (7–25) awaiting jean's rulings**, recommended A on most: 7 raw value in json mode writes the whole knex client (refuse), 8 Date/bigint json on sqlite/mysql/mssql/oracle (port binding), 9 `from_db` drops length/precision on mysql/mssql/oracle, 10 pg union `from_db` varchar(5) truncates, 11 mysql/oracle JSON_TABLE NULL ON ERROR, 12 mysql `utf8mb4_bin` vs `_ci` key, 13 null/Buffer key, 14 pg json Buffer column + uuid key, 15 dedupe by JS identity, 16–25 bounds/CI/docs.

**CodeQL alert (#26) → knex PR #3** `fix/pg-position-bindings-redos` (6463b2ba, worktree `/home/jean/dev/knex-redos`): pg `positionBindings` regex `/(\\*)(\?)/g` is quadratic (100k backslashes in an identifier = 17 s event-loop block; bound values never hit it). Fix `/(\\+)(\?)?|\?/g`, output identical (2.64M-case fuzz, 0 diff), upstream knex has the same bug, no issue. Reviewed: nothing to fix; 46 checks green except "Ensure PR has proper labeling" (needs `fix` label = CI re-trigger, awaits "label 3"). **UPDATE 2026-10-26:** #3 was merged into master then master reset to `0ff56f86`; fix lives on its branch + hhh-dev (see [[project_directus_knex_fork_switch]] flow). hhh-dev now has all of #2 (head c52c60e2). Directus pin bump = PR #637 (head 9c2ea044, pin `046fea90`); jean: "merge 637 once green" (merge commit, no auto-merge: repo has no required checks). knex#2 choices 7–25 still unruled. Old note: merging an upstream knex/knex PR each need jean's go; #2 gets the CodeQL fix only once #3 is in master.

**2026-10-26:** knex PRs now target `hhh-dev` only, never master ([[project_directus_knex_fork_switch]]). The upstream knex/knex redos PR is dropped unless jean asks. knex#2 (vs master) is already fully in hhh-dev.

**PR #638 (steps 2–3, `Fixes #636`) autoreview, ruled 2026-10-26 — finding 3: A (keep).** A number ≥ 1e21 into an `integer`/`bigInteger` field: the batch (JSON number) raises 22003 → `numericValueOutOfRange()`, per-group `.update()` raises raw 22P02 `invalid input syntax`. Accepted difference; do NOT add int types to `BATCH_TEXT_FIELD_TYPES` (would re-grow per-type String()ing). Probed on pg17; float/decimal/boolean/`1.5` identical on both paths. Not a review point to re-raise.
