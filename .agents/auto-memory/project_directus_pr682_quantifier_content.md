---
name: project_directus_pr682_quantifier_content
description: PR #682, merged as ff66eb6d8d on 2026-11-06 (quantifier content stays whole) plus 5 predating quantifier fixes; a slice can outlive a keying fix, gate on aliases not on unkeyed
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

Predating findings fixed on #682 (2026-11-06, base synced, NOT merged):
two quantifiers keyed as one row, a quantifier's rule unpinned, a count over a
quantifier rule 500, `$FOLLOW` o2a lacking its collection column, `generateJoi`
passing `_some`/`_none`.

**A slice can outlive a keying fix:** `slicePinsFor` lists the primary key among
its slices and the root pinner's `_and` keeps any conjunct's value, walking through
`_some`. So `filterKeying` going `unkeyed` did not unpin the read; a second gate
was needed (`scopedCacheCollectionsAcrossQuantifiers`). Gating on `unkeyed` itself
is too wide: it also holds for two scoped fields on one row and for a case folded
in from a nested node, where a slice is sound (12 tests fell bare).

**How to apply:** when a stale read survives a keying fix, print the read's tags and
`x-…-status` once before theorising; it took one diagnostic run to see `HIT` on
`link:id=1`.

Related: [[project_directus_pr678_join_alias_counter]],
[[reference_directus_query_now_not_cache_poison]].
