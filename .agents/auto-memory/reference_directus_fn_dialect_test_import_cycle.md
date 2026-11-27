---
name: reference_directus_fn_dialect_test_import_cycle
description: Unit test crashing "Class extends value undefined" on an import cycle — fn dialects: import via helpers/index.js; auth/drivers/local.ts: mock ../../auth.js, authentication service and respond, as oauth2.test.ts does
metadata:
  author: Jean Claveau
  type: reference
---

A test that imports `api/src/database/helpers/fn/dialects/<x>.ts` directly crashes at load: `Class extends value undefined is not a constructor or null`.

**Why:** cycle `dialects/x.ts` → `types.ts` → applyFilter → `helpers/index.ts` → `fn/index.ts` → back into the dialect, before `FnHelper` exists. Hit in PR #678 (commit 17d488823b): the 4 tests never ran, so `codecov/patch` fell to 67.5% (97.5% after fix e9d457ee14).

**How to apply:** import the class through `../index.js` so the cycle closes after `FnHelper` is defined. When codecov patch drops after adding tests, check the Unit Tests log for load-time errors before blaming upload lag. See [[project_directus_pr678_join_alias_counter]].

**Auth drivers (PR #772):** `auth/drivers/local.test.ts` hits the same kind of cycle through `api/src/auth.ts`, which imports the drivers back. Importing through `./index.js` (0dd9e62d4e) and importing `../../auth.js` first (2a5ab5a7f7) both failed, one CI push each. What works (eca970134d) is the `oauth2.test.ts` setup: import `./local.js` and `vi.mock` `../../auth.js`, `../../services/authentication.js` and `../../middleware/respond.js`. Start a new driver test from those mocks.
