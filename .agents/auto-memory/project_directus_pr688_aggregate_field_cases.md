---
name: project_directus_pr688_aggregate_field_cases
description: Fork PR #688 (issue #687) wraps an aggregated field in a CASE by the rules granting it; open choices on the scoped cache and on meta counts, nested aggregate 500 predates it
metadata:
  type: project
---

Fork PR #688, branch `v11.10.1-fix/aggregate-field-cases`, fixes #687. Not approved for merge.

Non-obvious facts it left:

- A grouped aggregate's CASE reads a rule that `injectCases` dropped from `ast.cases` (rules granting no requested key go, and the group field is the only child). The scoped cache derives everything from `ast.cases`/`query`, so it neither fingerprints nor views that rule's rows: stale aggregate. Ungrouped is safe, its children are empty and every rule stays. See [[project_directus_scoped_cache_tag_derivation]].
- `MetaService.filterCount` and the app export read `countDistinct` of the primary key as a row count, so a case on the key undercounts `filter_count`/`total_count`.
- A nested o2m aggregate needs `deep[x][_sort]` on the group: the o2m defaults its sort to the primary key, only the top level drops it, else pg refuses it (500). Predates #688.
- A plain record of operations resolves `constructor` to the inherited `Object`; #688 keeps them in a `Map`.
- A request-table scenario stops at its first failing request, so a new witness request goes FIRST in its scenario, or it is never seen red.
