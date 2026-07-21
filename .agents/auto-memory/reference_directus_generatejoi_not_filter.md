---
name: reference_directus_generatejoi_not_filter
description: @directus/utils generateJoi is a VALIDATION-schema builder, not a filter matcher — don't reuse it for client-side row filtering; absent-field + _null polarity diverge
metadata:
  type: reference
---

`generateJoi(fieldFilter)` from `@directus/utils` (exported, app-importable) builds a **Joi validation schema** for one field-filter — it is NOT a faithful `Filter → boolean` matcher. Reusing it to filter already-loaded rows client-side regresses:
- **Absent/undefined field passes validation** — Joi treats a missing field as valid unless `.required()`, so `{user:null}` wrongly MATCHES `user_id.email._contains:'x'` (should be false — a null user has no email).
- **`_null:false` polarity diverges** — `{user:'u1'}` vs `_null:false` ("is not null") returns false, not true.
- Single-field / single-operator (`Object.keys(filter)[0]`, first op only); throws on an empty rule.

There is **no exported `Filter → boolean` helper**. The boolean matcher `passesFilter`/`filterItems` (`api/src/utils/filter-items.ts`) is a thin Joi wrapper but **server-only, unexported**. Real server filtering is SQL, not Joi — that's why validation ≠ filtering here.

**Why:** PR #227 review suggested reusing `generateJoi` for the cache page's client-side `matchesFilter`. Tried it, 2 filter-entry tests regressed (the two cases above), reverted to the hand-roll + documented. The reuse LOOKS right (same operators) but Joi's validate-not-match semantics break it.

**How to apply:** for in-memory/client-side Directus-filter evaluation, hand-roll the operator switch (or wrap `generateJoi` per-op AND special-case absent/null) — a bare `generateJoi().validate(row).error===undefined` is wrong. Verify any "reuse this util" review suggestion by running the existing tests UNCHANGED first; if they diverge, it's not a drop-in → revert + document, never weaken the tests ([[feedback_dont_weaken_test_assertions]]). Related: [[reference_directus_load_and_infra_nets]].
