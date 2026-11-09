---
name: reference_directus_fn_dialect_test_import_cycle
description: Unit test importing a helpers/fn/dialects/*.ts file directly crashes "Class extends value undefined" — import the dialect via helpers/index.js
metadata:
  author: Jean Claveau
  type: reference
---

A test that imports `api/src/database/helpers/fn/dialects/<x>.ts` directly crashes at load: `Class extends value undefined is not a constructor or null`.

**Why:** cycle `dialects/x.ts` → `types.ts` → applyFilter → `helpers/index.ts` → `fn/index.ts` → back into the dialect, before `FnHelper` exists. Hit in PR #678 (commit 17d488823b): the 4 tests never ran, so `codecov/patch` fell to 67.5% (97.5% after fix e9d457ee14).

**How to apply:** import the class through `../index.js` so the cycle closes after `FnHelper` is defined. When codecov patch drops after adding tests, check the Unit Tests log for load-time errors before blaming upload lag. See [[project_directus_pr678_join_alias_counter]].
