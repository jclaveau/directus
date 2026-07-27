---
'@directus/types': minor
'@directus/api': minor
---

Expose `context.scopedCache.purgeForMutatedRows(collection, mutatedRows)` on register-type hook/endpoint/operation extensions, so code that mutates rows outside `ItemsService` (e.g. a raw `knex` bulk write for performance) can purge just the affected scoped-cache slices instead of flushing the whole cache. Row-based: for a flat-scoped collection the host derives the touched per-user slices from the collection's `scopedCacheFields`, purges the collection's bare tag (global reads) + those slices and spares every other collection. When a slice can't be resolved from the rows — a row missing a scope field, or a collection scoped through a relation (whose terminal a raw row doesn't carry) — it fails safe to a collection-wide purge rather than risk a stale slice; with scoped purging off it falls back to a full `cache.clear()`. This is the out-of-band counterpart to the CRUD-filter-hook `context.scopedCache.purgeBy(tags)` (#292). Prefer `ItemsService` (automatic purge) — reach for this only when you deliberately bypass it.
