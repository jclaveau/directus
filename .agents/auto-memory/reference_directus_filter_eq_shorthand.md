---
name: reference_directus_filter_eq_shorthand
description: A Directus filter takes {field: value} for {field: {_eq: value}}, and fields/sort take a list or a comma string
metadata:
  type: reference
---

`parseFilter` wraps a non-object filter value into `_eq` for you
(`packages/utils/shared/parse-filter.ts`, `parseFilterRecursive`), and
`sanitizeFilter` runs `parseFilter` before anything downstream sees the query
(`api/src/utils/sanitize-query.ts`). So `filter={"owner":"tau"}` and
`filter={"owner":{"_eq":"tau"}}` reach the service as the same object — same AST,
same pins, same cache key.

`sanitizeFields` (same file) reads `fields`, `groupBy` and `sort` from either a
list or a comma string into the same array, and splits a list member that itself
carries commas. Over supertest, `.query({fields: ['id', 'owner']})` serializes as
`fields=id&fields=owner`, which qs parses back into a list; a one-member list
arrives as a string and is split to the same array.

**Why:** a test or an example can state the short form without moving the entry
it is asserting on — the cache key is built from `sanitizedQuery`, which is the
expanded form either way.

**How to apply:** write `owner: tau` and `fields: [id, owner]` in specs and docs;
keep the `_eq` spelling only where the point IS the operator.

Related: [[reference_directus_gherkin_yaml_cells]],
[[project_directus_filter_normalization_layers]],
[[project_directus_cache_key_identities]].
