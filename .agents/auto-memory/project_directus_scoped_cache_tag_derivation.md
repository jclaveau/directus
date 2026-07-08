---
name: project_directus_scoped_cache_tag_derivation
description: how the scoped-cache feature decides which collections a read is tagged with (the invalidation surface)
metadata:
  type: project
---

Scoped cache (PR #205) tags a cached read with every collection whose data feeds it; a write to any tagged collection purges the entry. The tag set comes from `collectionsInFieldMap(fieldMapFromAst(ast))`.

What gets tagged (all sound — over-purge, never stale, for AST-visible deps):
- **Root** collection always.
- **Relations in `fields`** — m2o/o2m: target tagged; m2m/m2a: junction always, target only on a **deep** read (`tags.<col>_id.*`, `blocks.item:<col>.*`). Shallow (`tags.*`) tags junction only (no target data in response).
- **Relations in `filter`/`sort`/`aggregate`/`groupBy`** — `fieldMapFromAst` processes `ast.query` (not just `ast.children`); `extractFieldsFromQuery` follows the relational path and registers every collection on it. So a relation used ONLY in a deep filter (never selected) is still tagged.
- **M2A** — over-tags ALL `one_allowed_collections` (permission-filtered), built statically in `parse-fields.ts` regardless of which junction rows point where. Dynamic target ≠ a hole.

Value-level slicing (`pinnedScopeTagsFromFilter`): root **scalar** scope fields only (`_eq`/`_in` via root or `_and`). Relational/deep-filter paths are NOT value-pinned → bare collection tag. By design: `cache.purge` (no records/query) must reproduce any tag from the mutation alone.

Two review concerns CHECKED + DISMISSED (don't re-raise):
- **Dynamic vars (`$CURRENT_USER`/`$NOW`) NOT a stale hole.** Pinning reads `updatedQuery.filter` (pre-AST), but `sanitizeQuery` (`api/src/utils/sanitize-query.ts:195`, `parseFilter`+`fetchDynamicVariableData`) resolves `$`-vars at the CONTROLLER (`req.sanitizedQuery`) before the service. So the service sees the concrete uuid/timestamp → pin matches write side. A literal `$VAR` only reaches the service on an internal hand-built filter, which is already broken (service doesn't resolve vars). `$NOW` also uses range ops (`_gt`/`_lt`) which aren't pinned anyway; its only staleness is the generic time-relative-cache TTL problem, orthogonal to scoped purge.
- **Multi-field pinned read over-purges by union — safe direction.** Tags are per-field (OR), not per-tuple: read `student _eq A AND year _eq 2024` → `sadd`'d into both `slot:student=A` AND `slot:year=2024` separately. A write to `student=A, year=2023` purges via `slot:student=A` even though that row can't affect the read. Drops a still-valid entry (recompute), never serves stale. Per-field because the write side can't reconstruct the exact tuple on a partial update. Same granularity axis as the PR's read-fan-out open question.

The bug that prompted all this: the `cache.scope` filter return-value aliasing wiped the whole tag set → see [[reference_directus_emitfilter_same_ref]].

Only real stale vector left = enrichment **outside the AST** (an `items.read` hook/flow pulling from a collection not in fields/filter/sort). The `cache.scope` filter (now also given `records`) + a reproducible `cache.purge` is the userland escape hatch.

Tests rest on this: `api/src/services/scoped-cache-relations.test.ts` (unit, all types + deep filter/sort) + `tests/blackbox/.../cache.test.ts`.
