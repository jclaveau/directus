---
name: project_directus_pr306_purge_for_mutated_rows
description: PR #306 (#304) context.scopedCache.purgeForMutatedRows — out-of-band scoped-cache purge for raw writes, context-injected (not host import), relational fail-safe; merged; #307 read-side parked, #308 seed-retry follow-up
metadata:
  type: project
---

PR **#306** (closes **#304**), **MERGED squash `3e174e0419` into `v11.10.1-hhh-dev` 2026-07-27.** Sibling to #292 ([[project_directus_pr292_cache_hook_scopedcache]]): the **out-of-band** counterpart to the CRUD-filter-hook `purgeBy`.

**`context.scopedCache.purgeForMutatedRows(collection, mutatedRows)`** on register-type hook/endpoint/operation extensions — purges scoped-cache slices after a write done OUTSIDE ItemsService (raw `knex` bulk write). Type `ScopedCacheExtensionHandle` in `packages/types/src/read-meta.ts`; impl `createScopedCacheExtensionHandle(getSchema)` in the leaf module `api/src/extensions/lib/scoped-cache-handle.ts` (named -handle to disambiguate from the `api/src/scoped-cache.ts` engine); wired into the 3 context literals (manager.ts registerHook + registerEndpoint, flows.ts operation handler).

**Delivered THROUGH the context, NOT an exported host fn** — the load-bearing design call ([[feedback_expose_via_context_not_import]]): typing `import {…} from '@directus/api'` drags api's whole `.d.ts` graph into the extension build (runtime externalizes via `directus:api`, but TYPES don't). The handle rides `ApiExtensionContext` (in `@directus/types`, already an SDK dep) → zero new consumer dep. Namespaced `scopedCache.*` (not flat `purgeScopedCacheForMutatedRows`) = one radical across contexts, capability=presence (calling `purgeBy` in an endpoint won't compile — method absent; `EventContext.scopedCache` vs `ApiExtensionContext.scopedCache` are distinct objects, no collision).

**Fail-safe correctness (the review-found bug, fixed in-PR):** row-based derivation only works for FLAT scope fields. For a **relational scope** — an explicit dotted field, or an M2O field that `composeScopedCachePaths` derives into a deeper path — a raw row carries only the first-hop fk, not the pinned terminal, so a flat fk tag misses the real slice → stale. Fix: detect `scopeFields.some(f=>f.includes('.')) || composeScopedCachePaths(schema,collection).length>0` → collection-wide purge (`purgeScopedCache(cache,collection,null)`). Also switched `scopedCacheTagsFromRows` from `'skip'` to `'coarse'` so a row missing a flat field also degrades to collection-wide (over-purge, never stale). General principle: **write-side row derivation is sound (rows written = slices to drop); read-side is NOT** (returned rows don't bound future matches) — the parked read-side follow-up.

**Accepted / do NOT re-raise:**
- Scoped-off branch keeps an explicit `await cache.clear()` (option a) over delegating to `purgeScopedCache`'s own fallback (c) — jean chose a for readability after seeing the diff; the drift risk is theoretical (no-tag-index⇒flush is fundamental).
- Register-type extensions only (sandboxed can't reach host `getCache()`) — documented on the interface, same limit as #292.

**Follow-ups:** **#307** (enhancement, parked) = read-side / cacheable-custom-endpoint scoping — needs BOTH a cache-write path for custom endpoints AND author-declared filter-bounded `scopeTo` (a raw SELECT has no filter to soundly scope from; can't mirror #304's row derivation). **#308** = `CreateItem` seed-retry, the blackbox-flake fix surfaced here ([[project_directus_blackbox_flakes]]) — its improved error message revealed the true cause is a **403 schema/permission-cache race after CreateCollections** (not pool pressure); the first 4×200-600ms retry was too short to clear it → needs a longer window / schema-cache wait. NOT yet proven; do not claim fixed. bb tests: `cache-raw-purge.test.ts` (flat) + `cache-raw-purge-relational.test.ts` (M2O-composed), extension `tests/blackbox/extensions/cache-raw-purge`.
