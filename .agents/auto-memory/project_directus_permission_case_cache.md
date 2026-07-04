---
name: project_directus_permission_case_cache
description: PR #212 — scoped-cache read tags pinned off permission cases (ast.cases) + covered-gated multi-field _or union in the filter pinner; settled design decisions so a fresh review doesn't re-litigate
metadata:
  type: project
---

PR **#212** `feat(cache): pin scoped-cache read tags off permission cases`. Branch `v11.10.1-feat/scoped-cache-permission-cases`, base `v11.10.1-hhh-dev` (carries #205 scoped-cache + #210 relational pin). Supersedes #206. Green pg+sqlite.

**Problem:** planner reads get the BARE collection tag (one user's write purges everyone's slice) because the partition predicate (`owner_field = $CURRENT_USER`) lives in a **permission policy** → injected as `ast.cases`, not in the query filter. `pinnedScopedCacheTagsFromFilter` only read the filter.

**Mechanism (final):**
- Recursive evaluator (`evalNode`/`evalOr`/`evalLeaf` + `unionTags`) returns `{tags, covered}` per node — `covered` = "every row this node matches carries ≥1 pinned tag". `_and`/root **union** tags and are covered if **ANY** conjunct is (row meets all); `_or` is pinnable **iff EVERY branch is covered** (else a row matching an uncovered branch is stale), then **unions all branches' tags across fields**.
- `items.ts` pins off `joinFilterWithCases(updatedQuery.filter, ast.cases)` — ONE call, the **same combiner run-ast uses for the SQL WHERE** (`{_and:[filter,{_or:cases}]}`), so the pin can't diverge from what the query returns. `pinnedScopedCacheTagsFromCases` was deleted (folded in). See [[feedback_reuse_source_of_truth_combiner]].
- Bonus: query `?filter[_or][…]` now pins the union too (was bare).
- **Multi-field `_or` union (lift, commit 309b6de95e):** a case set / query `_or` whose branches bind DIFFERENT scope fields (`{_or:[{owner:A},{dept:X}]}`) now pins BOTH `(owner,A)+(dept,X)` instead of bare — sound because the purge model ORs at the tag level (a read under >1 tag drops if a write hits any). Was the old "different-field → bare" floor; the `covered` gate replaced it.

**SETTLED — do NOT re-raise in a fresh review:**
- **No dynamic-var resolver in the pinner.** `ast.cases` arrive already `parseFilter`-resolved (`fetchPermissions`→`processPermissions`→`parseFilter`), incl. the SHARE path (`getPermissionsForShare`: policy perms via same fetch, generated perms are concrete PKs). `$CURRENT_USER`/`$NOW`/`$CURRENT_ROLES` are concrete values here — never literal `$…`. Do not re-add `resolveScopeCaseValue`.
- **DNF rejected.** Distributing `_and` over `_or` is worst-case exponential on user/policy-controlled filters; the linear over-approximating walk is the bounded form. Don't propose normalization.
- **No `_not` in directus filters** (only `_and`/`_or`; negation is per-operator `_neq`/`_nin`/`_nnull`). Pinner only pins `_eq`/`_in`, so negations degrade to bare — no inversion edge.
- **Multi-field `_or` union IS supported** (lifted — see Mechanism). The retained sound floor is narrower: a branch binding **NO pinnable field** (e.g. the `{string_field:_nnull}` 2nd case in the multi-case bb test, or a non-scope `_contains`) fails the every-branch-covered gate → the whole `_or` is bare. Do NOT re-propose the floor as "different-field→bare" — that's stale; different pinnable fields now union.
- **`_and` uses value-UNION over-approx** (not intersection) — intentional, over-purges/never-stale.
- **Root `ast.cases` only** — nested `child.cases` are per-relation, out of scope (scope fields live on the root collection).
- **`covered` gate is the whole soundness argument** — union-all-branches would be UNSOUND without it (an uncovered branch's rows carry no tag → stale). Unit-tested in isolation.

Proof: `scoped-cache-tags.test.ts` (`_or` union / unbounding-branch / relational-in-`_or` / `_and`-over-`_or` / empty-`_or` / `_or` dedup / `_and` same-field union / empty-`_in`→bare / **multi-field `_or` pins both** / multi-field-with-unbounding-branch→bare) + blackbox in `cache.test.ts` (per-user isolation, resolved-token guard, multi-case→bare, multilevel `_and`, two-policy same-field union, query-`_or` union, **relational permission-case** `{owner_ref:{id:{_eq}}}`, **two-scope-field multi-field union** via dedicated `test_app_cache_scoped_multi` collection — spare-on-neither witness). Commits: 309b6de95e (lift) + 87be9b35de (bb witness) + 39b3ee89ab (90-col style). Related: [[project_directus_service_cache]].
