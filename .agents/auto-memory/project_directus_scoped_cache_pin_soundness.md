---
name: project_directus_scoped_cache_pin_soundness
description: The invariant a scoped-cache key pin rests on (rows depended on ⊆ rows nested) and the two query shapes that break it — filter/sort on the nested collection, and a parent hidden by deep._filter/permissions
metadata:
  type: project
---

Pinning a nested collection by the primary keys of the parent rows a response carried
is sound **only while the rows of that collection the response DEPENDS ON are a subset
of the ones it nested**. Insert-blindness is NOT the whole argument — I wrote that in
the docblock and the PR body, and both staleness bugs below are UPDATEs.

**Two shapes break it, both reproduced:**

- **A root `filter`/`sort`/`group`/`aggregate` on a path into the collection.** The
  row set depends on rows never nested: rename another parent to match and its items
  join the result, while the entry carries only `<coll>:id=<nested key>`.
- **A parent withheld by `deep._filter` or permission `cases`.**
  `mergeWithParentItems` defaults every m2o slot to `null` and fills only the rows the
  nested query returned, so "FK is NULL" and "parent hidden" are the same value after
  the merge (`merge-with-parent-items.ts:29`).

**Fix:** `scopedCacheCollectionsBeyondNestedRows(schema, ast)` names both from the AST
— the root side via `extractFieldsFromQuery` over
`joinFilterWithCases(ast.query.filter, ast.cases)`, the nested side via any m2o node
carrying `query.filter` / `cases` / `whenCase`. Those keep the bare collection tag.

**Why the AST and not the field map:** `extractPathsFromQuery` puts filter and sort in
`readOnlyPaths`, which lands in `fieldMap.read` — the SAME group as projections. The
field map cannot tell "projected" from "filtered on".

Related: [[project_directus_pr393_accepted_exceptions]], [[project_directus_cache_key_identities]].
