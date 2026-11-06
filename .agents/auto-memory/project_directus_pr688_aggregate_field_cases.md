---
name: project_directus_pr688_aggregate_field_cases
description: Fork PR #688 (issue #687) wraps an aggregated field in a CASE by the rules granting it; `aggregateCases` feeds the scoped cache, a primary key count takes no case, nested aggregate 500 predates it
metadata:
  type: project
---

Fork PR #688, branch `v11.10.1-fix/aggregate-field-cases`, fixes #687. Not approved for merge.

Non-obvious facts it left:

- A grouped aggregate's CASE reads a rule that `injectCases` dropped from `ast.cases` (rules granting no requested key go, and the group field is the only child). The scoped cache derives everything from `ast.cases`/`query`, so it neither fingerprints nor views that rule's rows: stale aggregate. Ungrouped is safe, its children are empty and every rule stays. See [[project_directus_scoped_cache_tag_derivation]].
- `MetaService.filterCount` and the app export read `countDistinct` of the primary key as a row count, so a case on the key undercounts `filter_count`/`total_count`.
- A nested o2m aggregate needs `deep[x][_sort]` on the group: the o2m defaults its sort to the primary key, only the top level drops it, else pg refuses it (500). Predates #688.
- A plain record of operations resolves `constructor` to the inherited `Object`; #688 keeps them in a `Map`.
- Decided 2026-11-06 (jean): #1 option A (new AST field, e.g. `aggregateCases`, from `injectCases`, read by `addNodeFields` and `addCollectionsQueriedBy`; `cases` stays the row filter). #2 option A too: `count`/`countDistinct` of the primary key take no case. **Why:** jean asked "most reliable over time": one rule in the aggregate builder fixes meta, app export, SDK and extensions; B fixes one caller and the next undercounts silently. Both go red test first, then fix, on this branch.
- Fixed: `d12713d910`, `8823cf2d89`; all green on `8823cf2d89` (2026-11-06).
- A dependency in `viewFieldMap` or `beyondNestedRows` purges nothing unless a fingerprint names its collection: `fingerprintedCollections` and `collectionsToGuard` read only the field map and filter keying until `8823cf2d89` added `beyondNestedRows`. Helper unit tests went green while the blackbox stayed stale, so a new scoped-cache dependency needs an end-to-end purge scenario.
- Not traced: a PATCH on an unread root column (`bonus`) also purges the grouped entry. An over-purge, disclosed in the PR body.
- A request-table scenario stops at its first failing request, so a new witness request goes FIRST in its scenario, or it is never seen red.
