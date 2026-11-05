---
name: project_directus_pr678_join_alias_counter
description: PR #678 (issue #676, join-alias collision) — per-statement alias_<n> counter; accepted exceptions (dropped-dialect count tests, alias_4 gap, no docstrings), pre-existing review findings NOT to re-raise
metadata:
  author: Jean Claveau
  type: project
---

Fix: `createAliasGenerator()` (one per `getDBQuery`) returns `__alias_1`, `__alias_2`… (`__` = jean's "go C", keeps off a collection named `alias_1`); required `generateAlias` param everywhere, shared into `_some`/`_none` and `_relationalCount` subqueries. Option B chosen by jean over a random-alias patch.

**Settled — do NOT re-raise in a review:**
- The `count` unit tests for mssql/mysql/oracle (+ postgres) dialect files: jean ruled "go B" knowing AGENTS.md says no tests for dropped dialects — they exist only to clear the `codecov/patch` 95% gate (87.5% without). They run the shared `FnHelper._relationalCount` on `Client_SQLite3`, so quoting is sqlite's. Don't call them a violation.
- Alias gap (one number skipped) = `getDBQuery`'s `innerCaseWhenAliasPrefix = generateAlias()`, drawn only when an inner query is needed. NOT knex compiling twice (that theory was wrong).
- CodeRabbit "Docstring Coverage" pre-merge failure: not a repo rule, contradicts fewer-comments. No reply, no change.
- `alias_<n>` could equal a user collection named `alias_<n>`: jean ruled "go C" → prefix is now `__alias_<n>` (red test first: root collection `alias_1` joined to `users`). Residual: a collection literally named `__alias_1` is still allowed. `directus_` prefix rejected (reads like a system table). Don't re-raise.
- `_some`/`_none` o2m root-join fan-out: jean ruled "fix it in the current pr" (reversing my "separate PR" advice). Proven first: blackbox `items/aggregate-o2m-some.feature` (count "2" vs "1"). Perf measured on pg18 (100k articles/500k links): without an index on `links.article_id` (Directus creates none on o2m FKs) list read 105.7 vs 35.3 ms (3.0×), buffers 5892 vs 596; with the index 20.4 vs 23.7 ms (no cost). Count is wrong on every schema. Landed: `3437fbd6cb` skips the root join in `addJoins` when `filterPath[1]` is `_some`/`_none`; bb red on `0705a46e25`, CI all green on `3437fbd6cb`. Scoped cache unaffected (pins come from the AST filter, not SQL joins). Blackbox `nested-o2m-steps.ts` `then` made `.optional` so a scenario may end on the When.

**Pre-existing (reported, not this PR's):** `count(...)` filter/sort call `getColumn` without `query` so permission filter is not applied; postgres.ts:51 `collections[table]` breaks through a join alias; `toQuery()` inlines `?` bindings in `_relationalCount`; three `filter/index.test.ts` tests never prime `aliasFn`.

**Gotchas hit:** CodeRabbit reviews once per hour (plan limit) — tick "Trigger review" only once per hour, so a small follow-up commit stays unreviewed. See [[project_directus_vitest_typecheck_gate]] for the type error that vitest's summary hid.
