---
name: project_directus_pr371_accepted_exceptions
description: PR #371 (purge the collections a delete cascades into or nullifies + slice index) — MERGED 2026-08-20; settled points a fresh review should not re-raise
metadata:
  type: project
---

Merged `9649af563e45`. Two goals in one PR, deliberately: the `ON DELETE` purge fix
and the `scalabus:slices:<collection>` index that replaces the keyspace SCAN in
`purgeCollectionScopedCache` (issue #374). Accepted — the cascade fix multiplies
collection-wide purges, so it needs them to be affordable. Don't re-propose a split.

**Settled — do NOT re-raise:**
- **Coarse bare tag per changed collection**, not resolved slices. Resolving them
  means reading every doomed row before the delete, on the hot path, and the rows
  are gone afterwards. Over-purging is safe, stale is not.
- **`SET NULL`/`SET DEFAULT` do not propagate.** The walk reports them and stops:
  the rows survive, so nothing below them changed. Pinned by a bb assertion that a
  CASCADE child *below* a nulled collection stays **HIT**.
- **The visited set is separate from the reported set** on purpose, so a collection
  reached by a non-propagating rule first is still walked on a later cascading path.
- **A direct self-relation is exempt only when it rewrites** (`SET NULL`/`SET DEFAULT`),
  not on CASCADE — a self-CASCADE IS reported. An earlier revision had this wrong.
- **`pipeline.sadd(tagKey, key, …, ...extraSiblings)` keeps its spread** — bounded and
  small, the documented-fine shape. Likewise `redis.unlink(...keys)` in
  `cache-events.ts` is one SCAN batch at `COUNT 100`.
- `queueCachePurge`'s exemption from the capture flag is a separate concern → #375.

**Fixed during review (mine):** `srem` and BOTH `del` call sites took an unbounded
spread — `redis.del(...tagKeys)` in `purgeScopedCacheTagKeys` and
`useRedis().del(...tagKeys)` in `dropScopedCacheTagIndex` (the longest list, a
whole-keyspace scan). All three now use the array form, assertions pin it.
[[reference_ioredis_array_args_vs_spread]]

**Flake seen:** shard 1 died on `CreateFieldM2O` → `403 FORBIDDEN`, the documented
seed schema-cache race — note #308's retry covers `CreateItem` only, `CreateField`
has none. Cleared on a plain rerun. [[project_directus_blackbox_flakes]]
