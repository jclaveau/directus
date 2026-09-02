---
name: project_directus_filter_normalization_layers
description: A read's filter is normalized at three layers and only parseFilter is shared, so the AST describes a different query than the one that runs — the root cause of the scoped-cache tag divergences fixed in PR #402
metadata:
  type: project
---

| step | where | seen by cache / field map |
| --- | --- | --- |
| `parseFilter` (bare leaf → `_eq`, lifts `_and`/`_or`) | `sanitize-query.ts:195`, middleware | **yes** |
| `normalizeFilter` (splits sibling keys) | `apply-query/filter/index.ts:32` | no |
| `getColumnPath` → `addNestedPkField` (appends the related PK) | `apply-query/filter/index.ts:187`, `sort.ts:89` | no |

Steps 2-3 run inside the query builder and die with it. `ast.query.filter` keeps the
un-expanded shape, so anything reading the AST reasons about a different query.

**What it cost (all measured, all fixed in #402):**
- `?filter[rel][_gt]=7` joins `rel` but `flattenFilter` stops at the `_`-prefixed key,
  so `extractFieldsFromQuery` never names the collection and the read carried **no tag
  at all** — silent staleness for 9 operators.
- Four spellings of one query (`{rel:{id:{_eq:X}}}`, `{rel:{id:X}}`, `{rel:{_eq:X}}`,
  `{rel:X}`) compile identically; only the longhand was keyed.
- `getCacheKey` hashes the sanitized query, so those four land in **2 cache keys** —
  duplicate entries for one query. NOT fixed: the key is computed at `app.use(cache)`
  (app.ts:312) before the router sets `req.collection` (355), so canonicalizing there
  would make lookup and fill disagree → 0% hit rate.
- `convertWildcards` (`:56`) splices EVERY field into `fields=*`, o2m aliases included,
  so a wildcard read nests its to-many relations — and a nested to-many can never be
  pinned. Cost me a wrong blackbox test.

**How to apply:** never re-derive a builder rule in a consumer; `expandRelatedKeyFilters`
mirrors `addNestedPkField` and is held to it only by
`apply-query/filter/related-key-join.test.ts`. Do NOT write the canonical filter back
onto the AST — `extractFieldsFromQuery` drives `validatePathPermissions`, so it would
change which permissions a query requires.

Related: [[project_directus_m2o_filter_needs_no_tag]],
[[project_directus_scoped_cache_tag_derivation]], [[project_directus_pr402_accepted_exceptions]].
