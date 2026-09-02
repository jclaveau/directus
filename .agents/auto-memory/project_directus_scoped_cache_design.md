---
name: project_directus_scoped_cache_design
description: Directus scoped (tag-based) cache invalidation — design record for PR #203 (getMeta rider, rejected alternatives, override audit, blackbox label gating)
metadata:
  type: project
---

PR #203 (`v11.10.1-feat/scoped-cache-invalidation` → `v11.10.1-hhh-dev`): `CACHE_AUTO_PURGE_MODE`
= `scoped` (default) | `full`. Scoped needs `CACHE_STORE=redis`; else auto-falls-back to full.

**Architecture facts (Directus v11.10.1-hhh-dev):**
- Response cache key = `hash({version, user, path, query, [ip]})` — already per-user; only
  *invalidation* was the sledgehammer (`cache.clear()` on every mutation).
- Touched-collection enumerator already exists: `fieldMapFromAst` + `collectionsInFieldMap`
  (`permissions/modules/process-ast`) — computed for permission scoping, then discarded. Walks
  fields AND filter/sort relations.
- `useRedis()` = shared **ioredis** singleton (for tag SADD/SMEMBERS/DEL). The keyv data-cache store
  is **@keyv/redis v5 (node-redis)** on this base — `getRedisConnection()` translates `REDIS_HOST/…`
  to `{socket}`. So delete tagged keys via `cache.delete()` (keyv), not raw UNLINK, to stay
  decoupled from the v5 key format.
- Tag index: `SADD <ns>:tag:<col> <key> <key>__expires_at`, `EXPIRE 2×CACHE_TTL`; purge = SMEMBERS →
  cache.delete each → DEL set.

**Design pivot — `getMeta()` rider over instance field** ([[feedback_per_op_data_off_instance_field]]):
tags ride each read's result via non-enumerable `getMeta()` (`WithMeta<T>` in `@directus/types`),
attached post-`emitFilter`. Rejected alternatives: changing `readByQuery` return shape (60 call sites
+ breaks the AbstractService contract + every wrapper readMany/readSingleton); `getCacheTags()` on the
array (severed by `[0]`/spread/hooks). GraphQL keeps a request-scoped union field (honest aggregate),
stamped onto the `execute()` result.

**Override audit (the completeness trap):** widening `readByQuery`→`WithMeta` means auditing every
override. Only `FilesService` (passthrough, ok) + `PermissionsService` (rebuilds via
`withAppMinimalPermissions` → must re-attach the rider) override it. Found via
`grep "override async read*"` + `extends ItemsService`. Whole api typechecks 0 errors after.

**Blackbox is label-gated:** add `Run Blackbox` (pg+sqlite smoke) or `Run Blackbox Full` (all
vendors) label via REST (`gh api … /issues/N/labels`); `blackbox-pr.yml` runs `if contains(labels,
'Run Blackbox')`. Scoped-cache logic is redis (vendor-independent) → smoke suffices. New blackbox env
`envRedisScopedPurge` asserts cross-collection isolation.

Parked follow-ups: [[project_directus_sql_query_cache_parked]] (partition tags, owner-tagging,
extension `addCacheTags()`).

## VALUE-LEVEL layer shipped (2026-06-26) — PR #205 → `v11.10.1-hhh-dev`

Extends #203's collection-level invalidation to **per-value** slices. Branch
`v11.10.1-feat/scoped-cache-value-tags`, the `scopedCache` idiom
([[feedback_name_vocabulary_one_radical]]).

- **Config:** new `directus_collections.scoped_cache_fields` (JSON column, admin `system-field-tree`
  multi-select on the data-model page) names a collection's owner/partition columns. Rides the
  `/schema/snapshot` (whole-`meta` pick) → **directus-schema-sync carries it free**; surfaced in
  `CollectionOverview.scopedCacheFields` via [[project_directus_get_schema_raw_knex_json]].
- **Tag type:** `ScopedCacheTag {collection, field?, value?}` in `@directus/types`; the rider's
  `ReadMeta.scopedCacheTags` went `Set<string>` → `ScopedCacheTag[]`.
- **Invariant:** a scoped read tags ONLY its value slices (`tag:slots:student=A`); the **bare
  collection tag holds only global reads** that couldn't scope. A write purges bare (global readers)
  **+ resolved value slices**, sparing every other slice. Writes resolve precisely: create from
  payload, update/delete from `snapshotScopedCacheTags` (pre-mutation SELECT) **∪ new** payload value
  (a row moved A→B drops both); `upsertMany` full-flushes (mixed insert/update, TODO).
- **READ-SIDE CORRECTNESS FIX (post-review, commit `cea4bea59b`):** the original #205 tagged a read
  by the scope values **present in its result rows** — a *latent staleness bug*. A multi-owner read
  (admin "all students" list) tagged only the slices it returned (A,B,C), no bare tag → an INSERT of
  a **new** value D purged `bare + D`, leaving that broad read stale (missing D). Regression vs #203's
  collection-level baseline (which purged the whole collection tag on every write).
  - Fix: scope the root off the **query filter**, not result rows — `pinnedScopeTagsFromFilter`
    (exported from `items.ts`). A read may carry a value slice **only when an `_eq`/`_in` on a scope
    field BOUNDS it** to that value (reached via root or `_and`; `_or` doesn't bound → skip; non-eq
    ops like `_gt` don't bound). Pinned → value slices (the planner's `?filter[student]=A` win);
    unbounded → bare collection tag → every write invalidates. **Principle: value-scoped cache tags
    must come from the query's bounding predicate, never the result set** — result rows are a snapshot
    that can't prove a future insert is excluded.
  - Using filter (not result) values also fixes the `_in[A,B]`-with-B-empty leak (B is tagged even
    with no rows yet). The **purge side still uses rows** (`scopedCacheTagsFromRows`) — that's correct
    (it enumerates the values a write actually touched).
  - `normalizeFilter` (apply-query) was considered and rejected: it canonicalizes *relational sibling*
    nesting for `getFilterPath`, orthogonal to scalar scope-field pinning; no-op for the flat planner case.
  - Also: `purgeCache` guards `redis.del()` against an empty tag set (a `cache.purge` filter could
    empty it → "ERR wrong number of arguments"); tag-key serializer's `String(value)` type-collapse
    documented as safe (a scope column has one stable type, tag+purge read the same column).
- **`cache.scope` / `cache.purge` filter pair** lets extensions add tags (M2M owners in userland) —
  whatever's added on scope must be reproducible on purge or an entry leaks. Relations stay bare.
- **Saga:** first built on `fork-feat` (instance-field, off the v11.10.1 tag) → #203 (rider) merged
  into hhh-dev mid-session → re-derived onto the rider (cache.ts identical base; only items.ts
  plumbing differed). Lesson → [[feedback_directus_new_feat_base_hhh_dev]] (sync hhh-dev first).
- **CI:** a PR into `v11.10.1-hhh-dev` runs **no full suite** — `check.yml`/blackbox gate on
  `base: main`; only CodeQL `Analyze` fires. Validate locally: worktree + install
  ([[reference_agent_worktree_no_node_modules]]).

## Bare-tag purge ≠ collection-wide purge (the trap #358 exposed)

A read whose root pin resolves is tagged with its slices **instead of** the bare collection
tag — `readByQuery` pushes one or the other, never both. So:

- `purgeScopedCache(cache, coll, null)` → `purgeCollectionScopedCache`, which SCANs
  `<namespace>:tag:<coll>:*` and drops the bare key **plus every slice key**. This is how
  you purge everything in a collection, and every fail-safe path uses it.
- Putting a bare `[{ collection }]` in the tag list is NOT that: `purgeScopedCache` maps the
  tags it is handed to exact keys and DELs those, so a slice-pinned entry survives.

An ordinary mutation is safe because the bare tag travels *with* the resolved slices
(`[{collection}, ...tags]`), so list reads and keyed reads both drop. The only bare-only
purges are `purgeScopedCache(cache, coll, [])`, reached when nothing resolved — no keys
mutated, or `purgeForMutatedRows(coll, [])` — where not dropping keyed entries is correct.

**Extension-facing gap:** `purgeBy` takes tags and `purgeForMutatedRows` is row-based, so an
extension has no way to say "drop everything for collection X" except by handing over rows
missing a pinned field and leaning on the coarse fail-safe. Noted, not filed.

Every in-repo `purgeBy` caller passes `result.getMeta().scopedCacheTags` from a real lookup
read rather than hand-building a tag, which is why they all gained the key slices for free
([[feedback_reuse_source_of_truth_combiner]]).
