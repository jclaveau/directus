---
name: project_directus_filter_shapes_not_http_reachable
description: Filter shapes that look blackbox-testable but are refused before the service runs (_not, empty _in) or 500 on this fork (relational groupBy) — unit-test them instead
metadata:
  type: project
---

Three shapes cost a blackbox cycle each before proving they cannot be driven over HTTP.
`validate-query.ts` refuses the first two **before** `ItemsService` runs:

- **`_not`** — falls to the `default:` arm of `validateFilter`'s operator switch, so
  `validateFilterPrimitive` sees an object and throws *"has to be a string, number, or
  boolean"* → **400**. Anything reachable only under `_not` (e.g. a keying walk's
  sweep-everything arm) is therefore reachable only through a permission **case**, which
  bypasses query validation.
- **an empty `_in`** — `validateList` throws on `value.length === 0` → **400**. And the
  REST spelling `filter[x][_in]=` is NOT that shape: `parse-filter` sends it through
  `toArray`, yielding `['']` — one key, not none.
- **grouping across a relation** — `groupBy=owner.name&aggregate[count]=id` answers
  **500** on this fork (a scalar `groupBy=label` is fine). Unrelated to the cache; worth
  its own issue. Verified 2026-08-31 on #402.

**How to apply:** when a branch looks bb-reachable, check `validate-query.ts` first — it
is cheaper than a 7-minute suite run. Record the unreachable ones as a comment in the bb
file so the next reader does not re-add them, and cover them in the unit suite.

Related: [[project_directus_coverage_bb_vs_unit_split]], [[project_directus_pr402_accepted_exceptions]].
