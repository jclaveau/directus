---
name: project_directus_pr402_accepted_exceptions
description: PR #402 "increase the cache radius by avoiding bare tags" (fixes #401) — the scope jean imposed, the settled calls and the warnings kept on purpose; do NOT re-raise
metadata:
  type: project
---

PR **#402**, branch `v11.10.1-feat/scoped-cache-pin-relational-pk-filters`, base
`v11.10.1-hhh-dev`, `Fixes #401`. Six commits, one PR.

**Scope is jean's words and nothing else:** "The goal is to increase the cache radius by
avoiding bare tags NOTHING ELSE. Name the pr this way!" The title IS the goal. Issue
#404 (canonicalization) was opened as a follow-up and he made me **close and fold it in**
— see [[feedback_one_goal_one_pr_no_scope_shards]].

**Settled, do NOT re-raise:**
- Four `local/no-single-caller-function` warnings kept deliberately:
  `scopedCacheFilterKeyingByAlias` is recursive (cannot inline),
  `scopedCacheFilterKeyingByCollection` is exported and used from `items.ts` (the rule's
  known export blind spot), `keyingOfColumnConditions` and `hopsAcrossRelation` name the
  distinctions the SQL probe established. Warnings gate nothing.
- `scopedCacheCollectionsBeyondNestedRows` now means "beyond the nested rows AND beyond
  what the filter named". Docblock widened, name left — raised as a reviewer question.
- `_not` → `unkeyed` because `applyFilter` drops it without compiling anything; the
  contract test is where a future `_not` implementation should fail first.
- The AST is deliberately NOT rewritten (permissions) — see
  [[project_directus_filter_normalization_layers]].
- Duplicate cache KEYS (2 for 4 spellings) are known and NOT fixed here; the key is
  computed before `req.collection` exists.
- The ceiling stays `CACHE_SCOPED_MAX_PINS_PER_COLLECTION`, shared with #393.

**Behaviour changes reviewers will flag as regressions but are intended:**
- `scoped-cache-relations.test.ts` — a deep filter on an M2O key now tags nothing;
  two hops down tags the collection hopped THROUGH but not the leaf.
- Reads using unbounded operators on a to-many alias become purgeable where they were
  (wrongly) permanent residents — they were serving stale data.

Related: [[project_directus_m2o_filter_needs_no_tag]], [[project_directus_pr358_accepted_exceptions]],
[[project_directus_pr393_accepted_exceptions]].

## Second and third rounds (2026-08-31) — settled, do NOT re-raise

- **A filter's `count(rel)` was read as a row key.** `count(items)=5` pinned
  `items:id=5` — a cardinality mistaken for an id, so an insert nobody named could not
  drop the entry. Fixed by guarding `functionName` on the hop branch and in the expander;
  `keyingOfColumnConditions` already had that guard. Regression tests bb + unit.
- **`filter-shape.ts`** now holds `isFilterNode` / `hopsAcrossRelation`, which the
  expander and the keying walk each carried a byte-identical copy of. They must agree by
  construction: one decides what is rewritten, the other what is followed.
- **`scopedCacheCollectionsBeyondNestedRows` takes the keying as a defaulted parameter**
  so the caller's map is reused instead of walking the AST twice per read.
- **`stripInjectedOwnershipNesting` is exported for its unit test.** Module-private
  otherwise; reaching it through `readByQuery` would mean knex mocks for a pure
  records-in/records-out transform. Deliberate, jean chose it over the mock route.
- **12 lines in `scoped-cache.ts` are deliberately left uncovered** — fold results no
  walk produces, and `undefined` checks on an alias, a primary key and a path segment
  that no caller can deliver. Not worth a fabricated test.
- `codecov/patch` cleared at **95.14%** on `f0176806a5` (target 95%).

**A wrong assertion of mine, corrected in the suite:**
`{owner: {id: {_eq: 7, deeper: …}}}` reports `keyed` on `id`, not `unkeyed` — the
near-row shortcut bails (its "operators only" guard) and the hop recursion keys it. The
read does depend on owner 7, so keyed is right.
