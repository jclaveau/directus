---
name: reference_directus_takeover_cache_scoping
description: create-takeover scoped-cache purge is COARSE by default and narrows only when the hook declares its footprint via scopedCache.purgeBy — narrowing a takeover unconditionally poisons the old slice of an upsert-move
metadata:
  type: reference
---

When a create filter hook "takes over" a row (returns an existing PK instead of a payload → `liveKeys.length > actionPayloads.length` in `createMany`), the scoped-cache purge is **coarse (collection-wide) by DEFAULT**, and narrows to a precise slice purge **only if the hook declared its footprint** via `context.scopedCache.purgeBy` (renamed from `addTag`; see [[reference_directus_scopedcache_api]]).

**Do NOT re-attempt an unconditional takeover-narrow** (explored + rejected as PR #293, closed). The premise "the taken-over row's slice is knowable by re-read, so always snapshot(liveKeys)" is HALF-TRUE and unsafe:

- A takeover can be an **upsert-that-MOVES** the row between scope slices (hook finds an existing row, UPDATEs its scope field, returns its PK). That is a hidden UPDATE in the create path.
- `createMany` has **no old∪new capture** (creates normally have no "before"; only updateMany/deleteMany/upsertMany snapshot `oldScopedCacheTags` before the write). The purge snapshot runs AFTER the transaction commits (`this.knex`, ~items.ts:948), so it sees only the **NEW** slice. The **OLD** slice is unrecoverable → a cached read pinned to the old slice goes **STALE (poison)**.
- This is **NOT symmetric with normal creates** — a real create inserts a NEW row, so there is no old slice to leak. The adversarial poison-hunt (2 independent agent passes) confirmed it as a NEW regression, not the pre-existing "hooks side-effect other rows" limitation.

**The gate (items.ts `createMany`, ~L945):**
```
takeoverUndeclared = someRowTakenOver && scopedCacheCollector.tags.length === 0;
scopedCacheTags = takeoverUndeclared ? null /* coarse */ : snapshot(liveKeys); // ∪ declared
```
`purgeScopedCache(scopedCacheTags, collector)` unions the collector's declared tags. So:
- takeover + NO declaration → coarse null (safe — framework can't see the hook's footprint).
- takeover + declaration → snapshot(new) ∪ declared (a read-only dedup declares its 1 unchanged slice; an upsert-move must declare old + new).
- no takeover → snapshot(liveKeys) ∪ declared (unchanged from before).

Shipped on the `#292` addTag branch (`context.scopedCache.addTag` is the general CRUD-filter tag channel; see [[project_directus_scoped_cache_design.md]]). Tests: unit in `scoped-cache-purge.test.ts` (undeclared→null, declared→narrow); bb in `cache-takeover-scope.test.ts` with two hook extensions — `cache-takeover-dedup` (declares → narrow, ada MISS / bob HIT) and `cache-takeover-move` (undeclared upsert-move → coarse, moved-from slice MISS+empty, no stale). The bb witness needs `CACHE_AUTO_PURGE_MODE=scoped` + redis + `x-cache-status` (see [[project_directus_blackbox_value_scope_coverage.md]]).

Over-purge vs poison: a no-op dedup takeover purging its own (unchanged) slice is safe WASTE, not poison — `shouldClearCache` never gates on "did data change", so any create runs the purge. Poison only arises from UNDER-purge (the moved-from slice), which the coarse default prevents.

**Takeover vs cancel — why only takeover gets a coarse net.** A takeover returns a **PK** → the framework KNOWS a row is involved → coarse-purge fallback. A cancel returns **null** → NO signal a slice was touched → the framework treats it as a pure cache no-op (the null slot drops out of `liveKeys`, so it never false-triggers `someRowTakenOver` and is never snapshotted). So a side-effecting cancel (a hook that writes out of band, then returns null) has **no coarse safety net** — it MUST declare via `purgeBy` or its slice leaks. Coarse-gating every cancel would tax the common validation-skip case. Create/update/delete cancel all honor a declared `purgeBy` (create always drained the collector post-loop; update/delete were fixed this session to drain on their early-return cancel branch — see [[project_directus_pr292_cache_hook_scopedcache]]). The unfixed leak (side-effecting cancel with NO declaration) is a documented deferred, not gated.
