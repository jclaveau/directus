---
name: reference_directus_scopedcache_api
description: the context.scopedCache hook API (#292) — event-scoped scopeTo (read) / purgeBy (write), single union-typed field; full compile-time event→method typing is the follow-up #294
metadata:
  type: reference
---

`context.scopedCache` (PR #292, `v11.10.1-feat/cache-hook-add-tag`) is the CRUD-filter-hook channel for contributing scoped cache tags. It carries ONLY the method for the filter's event:

- `items.read` filter → `context.scopedCache.scopeTo(tags)` — scope the response TO extra slices it depends on (mirrors the `cache.scope` event). Drained into the read's `scopedCacheTags` meta rider.
- `items.create`/`update`/`delete` filter → `context.scopedCache.purgeBy(tags)` — purge cached responses BY extra slices this mutation touched (mirrors `cache.purge`). Unioned into the purge tags.

`tags` is one `ScopedCacheTag` or a batch — pass `result.getMeta().scopedCacheTags` from a lookup `readByQuery` to reuse the exact slices it pinned rather than hand-build a tag ([[feedback_reuse_source_of_truth_combiner]]). Idempotent (structural dedup). No-op when scoped purge is off / off the HTTP path. Backs [[reference_directus_takeover_cache_scoping]] (a create hook `purgeBy`s to declare a takeover's footprint and opt out of the coarse fallback).

**Type design (why two names, one field):** intent lives in the TYPE, not a jsdoc ([[feedback_privilege_types_over_jsdoc]]). Two handle interfaces `ScopedCacheScopeHandle{scopeTo}` / `ScopedCachePurgeHandle{purgeBy}`; `EventContext.scopedCache` is their union, and the service (`items.ts`) wires the ONE matching the event, so the other method is absent at runtime. Verb+preposition names (`scopeTo`/`purgeBy`) are symmetric and self-documenting.

**Follow-up = issue #294** (NOT in #292): the union means a strict-TS author must narrow to call `scopeTo`/`purgeBy`, and a wrong-side call is only a runtime error. Full compile-time enforcement needs event-parameterising the emitter: `EventKind<E>` template-literal map + `EventContext<K>` conditional + `FilterHandler<TIn,TOut,E>` + the `filter` registrar (`manager.ts`) inferring `E` from the event literal. ~3 files, backward-compat via `E=string` default. Deferred because (a) `EventKind` only maps `items.*` shapes — system reads `${scope}.read` fall back to the union; (b) gate is a repo-wide typecheck; (c) it benefits ALL event-typed context, so it stands as its own emitter-types PR.

**Cancel (return null) contract.** All mutation filters can cancel under `allowFilterCancel` (set by the REST controller + GraphQL + websocket handlers): create/update/delete filter returning `null` cancels the op (`return keys.map(()=>null)` / `results[i]=null`). Against the scoped cache a **pure cancel is a no-op** (nothing changed → no purge; the cancelled null slot drops out of `liveKeys` so it never false-triggers takeover). A **declaring cancel** (hook calls `purgeBy` THEN returns null) still purges — create always drained the collector post-loop; update/delete were fixed to drain on their cancel early-return too ([[project_directus_pr292_cache_hook_scopedcache]]). See the takeover-vs-cancel signal note in [[reference_directus_takeover_cache_scoping]].

**Full bb+unit witness matrix exists** (#292, cache-hook-add-tag branch): create `purgeBy` (takeover narrow/coarse via M2M + veto), read `scopeTo` (foreign-slice dependency), update+delete `purgeBy` (cross-collection cascade), create/update/delete cancel (pure + declared). See [[project_directus_pr292_cache_hook_scopedcache]] and [[project_directus_blackbox_m2m_nested_and_cancel]]. **CI-confirmed green on head `9533081e13`** (2026-07-23): all 20 bb shards (pg+sqlite ×5, both vendors), Unit Tests api/app/rest, lint/style/CodeQL — the delete double-emit removal + cancel-parity drain broke nothing (unit-api green with the fire-once pin).
