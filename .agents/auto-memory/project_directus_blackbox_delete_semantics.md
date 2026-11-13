---
name: project_directus_blackbox_delete_semantics
description: What Directus DELETE /collections and /fields really answer, and the blackbox cleanup helpers (strict vs IfPresent) + FK-order traps the strict version exposed
metadata:
  author: Jean Claveau
  type: project
---

`DeleteCollection`/`DeleteField` (tests/blackbox/common/functions.ts) THROW unless 204 (PR #614); pre-cleans use `DeleteCollectionIfPresent`/`DeleteFieldIfPresent` (204 or the one exact 403 "missing" message).

- DELETE /collections/:c missing → **403** `Collection to delete '<c>' does not exist`; DELETE /fields on missing collection → 403 `You don't have permission to access this.`; missing FIELD in an existing collection → **204**. Neither route ever answers 404.
- Self-relation collection DELETE → 500 `alter table drop column "parent" - relation does not exist`: **DeleteField the self field first**.
- Table still referenced by another FK → `cannot drop table X because other objects depend on it`: delete referencing collections first, in sequence not `Promise.all`; FK cycles (A.b→B, B.a→A) need one side's field dropped first.
- Cleanups silently failed before the helpers checked status (~255 afterAll calls); 7 files surfaced in one CI run, an audit script over all bb files found no others.

**Why:** silent cleanup failures leave state for the next file. **How to apply:** new bb collection with a self/cyclic relation → drop the field in afterAll before the collection; new pre-clean → IfPresent variant. Related: [[project_directus_batched_plumbing_design]].
