---
name: project_directus_blackbox_value_scope_coverage
description: Blackbox value-slice cache coverage — scoped_cache_fields via CreateCollection meta at seed time; strict-witness HIT/MISS design; upsertMany has no REST surface
metadata:
  type: project
---

Value-level `scoped_cache_fields` partitioning had ZERO blackbox coverage before this session (bb only proved collection-level isolation + relation depth). Added to `tests/blackbox/tests/db/app/cache.{seed,test}.ts`. Extends [[project_directus_blackbox_seed_mechanics]].

- **Configure scope fields at seed structure time** via `CreateCollection(vendor, { collection, meta: { scoped_cache_fields: ['owner_field'] } })`. `seedDBStructure` runs in the Blackbox *setup* job BEFORE servers boot, so the schema picks up `scopedCacheFields` at boot (servers cache schema). A self-ref relation = `CreateFieldM2O(..., otherCollection: <same collection>)`.
- **Strict-witness test design** — assert the value that FLIPS pre/post-fix, so the test is a real regression guard: self-ref read → MISS on another-owner write (bare, not pinned); create-omitting-field → pinned owner-A read stays HIT (precise null-slice purge, was MISS under coarse fallback); value-slice → A-write drops A, spares B.
- **`upsertMany` has NO REST surface** — `/items` POST=createMany, PATCH=updateMany; import uses `upsertOne` per row. So upsertMany value-scoping is unit-only (`scoped-cache-purge.test.ts`), not blackbox-able.
- **Pinned reads tag the slice ONLY (not bare)** — so a pinned owner-A read survives any write that isn't to slice A or bare-purging-A. That's what makes the create-precision witness work.

**Why:** user: "caching is too critical, add bb tests." **How to apply:** new cache behavior → add a strict-witness bb case where feasible (REST-reachable); shared-seed changes fast-fail the *setup* job first (watch it). Local bb run is heavy (docker + redis + multi-vendor) — CI Blackbox postgres+sqlite3 is the arbiter, see [[project_directus_blackbox_cache_local_repro]].
