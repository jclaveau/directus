---
name: project_directus_blackbox_silent_write_failures
description: blackbox seed helpers used to swallow failed writes so seed-database.test.ts went green over a broken schema — dataOrThrow now refuses non-2xx; the four latent defects that surfaced when it was switched on
metadata:
  type: project
---

Until #336 every `Create*` helper in `common/functions.ts` returned
`response.body.data` without checking the status. A rejected write produced
`undefined`, the seed carried on, and since seeds only assert
`expect(true).toBeTruthy()` inside a `try/catch` that nothing throws into,
`seed-database.test.ts` reported **20/20 green over a database it had failed to
build**. That is how a missing field reached CI.

All mutation helpers now go through **`dataOrThrow(response, what)`** — a
generalisation of the guard `CreateItem` already carried. `DeleteCollection` /
`DeleteField` stay silent on purpose (every seed calls them speculatively), and
`ReadItem` is untouched.

**Switching it on immediately surfaced four latent defects, all long-green:**
- **`test_biginteger` never had a default value.** `generateBigInteger` returns
  BigInt; `JSON.stringify` refuses it, so supertest sends the literal
  `"[unable to serialize…]"` as the whole body and the server 400s. Every
  `setDefaultValues` field POST had been failing. Fixed by `String()`, the detour
  `seedAllFieldTypesValues` already takes for item values.
- **`temp_relational` was never relational.** `schema.test.ts`'s *"confirm deletion
  of relational field does not nullify existing relational fields"* pointed its M2O
  at `test_schema_self` — unsuffixed, and only per-pkType collections are seeded —
  so the relation 400'd and the case deleted a plain column.
- **A second defect hid behind that dead call.** Once the target was suffixed,
  `CreateFieldM2O`'s default `primaryKeyType: 'integer'` asked postgres for an
  integer column referencing a uuid key: *"foreign key constraint cannot be
  implemented"*. Neither defect could surface while the other was silent.
- **`CreateUser` was not idempotent**, unlike `CreateRole`/`CreateField`/
  `CreateRelation` which all read back first. Now reads by email. Only bites local
  re-runs (CI shards start clean) but it makes local iteration impossible.

**How to apply:** a helper that swallows a status code is the bug, not the
convenience. When a seed "passes" but a downstream test can't find what it seeded,
suspect a swallowed 4xx before suspecting the test. Related:
[[project_directus_blackbox_batch_seeds]], [[feedback_instrument_before_theorising]],
[[project_directus_blackbox_seed_mechanics]].
