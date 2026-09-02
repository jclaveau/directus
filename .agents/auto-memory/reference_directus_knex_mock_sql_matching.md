---
name: reference_directus_knex_mock_sql_matching
description: knex-mock-client matches handlers against the raw SQL string, so a column name can steal another table's query; plus the RELATIONAL_BATCH_SIZE infinite loop in items.test.ts
metadata:
  type: reference
---

**`tracker.on.select('X')` matches the raw SQL, not the table.** A query
`select "owned_item"."owner" from "owned_item" …` contains the substring `owner`, so a
handler registered for `owner` claims the `owned_item` query and returns the wrong rows.

**Register the narrower/child matcher FIRST** — the first matching handler wins. Cost
me two debugging rounds in `api/src/services/items.test.ts`: once where a `owned_item`
handler swallowed the o2m child query (its WHERE names the FK column `owned_item`), and
once where an `owner` handler swallowed the root query (its SELECT names the column).
The symptom is not "no match" — it is plausible wrong rows, e.g.
`TypeError: Cannot read properties of undefined (reading 'toString')` inside
`mergeWithParentItems`.

**`RELATIONAL_BATCH_SIZE` must be set for any o2m read** in that file's env mock.
`run-ast` pages a to-many `while (hasMore)` and stops when a batch comes back SHORT —
`1 < undefined` is false, so an unset size loops forever and the test dies on the 5s
timeout with no clue.

**Also:** `fields: ['*']` expands into sibling relations, so a `*` in a mocked read
issues nested queries the tracker never answers. Name the columns explicitly.

Related: [[project_directus_pr393_accepted_exceptions]].
