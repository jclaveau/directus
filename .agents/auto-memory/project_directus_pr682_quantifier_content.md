---
name: project_directus_pr682_quantifier_content
description: PR #682 (quantifier content stays whole) autoreviewed 2026-11-06; empty content reads no relation via flattenFilter; predating quantifier findings, traced not run, await a routing decision
metadata:
  type: project
---

`normalizeFilter` stops at `_some`/`_none`; `getOperation` returns the quantifier
for `_and`/`_or` content only when `flattenFilter` finds a field path in it.

**Why the path check:** `{links:{_some:{_and:[]}}}` compiled a live subquery while
`flattenFilter` emitted no path, so no field permission check and no scoped-cache
pin saw `links`: a reader with no `links` permission got 200 and learned which
parents have links. Fixed in `8dce989929`.

**How to apply:** a filter branch compiling SQL must also produce a `flattenFilter`
path, or it is unchecked and unpinned. Red evidence needs witnesses: a filter test
passes with one condition silently dropped unless a parent separates the branches
(`qx-c`, `qn-c`), shown by a temporary one-branch mutation in `subQueryBuilder`.

Predating findings, reported on #682, not fixed there, routing not decided at
2026-11-06 (read in code, not run):
- two quantifiers on one relation keyed as one joined row, `paths.ts:268-271`;
- `count(rel)` with a quantifier in a permission case: bare `collection`,
  `filter/index.ts:154`;
- `$FOLLOW` quantifier subquery lacks the collection column an o2a join checks;
- subquery rule of the related collection, `filter/index.ts:188`: no `getCases`
  in `api/src/scoped-cache`, full trace unfinished.

Related: [[project_directus_pr678_join_alias_counter]],
[[reference_directus_query_now_not_cache_poison]].
