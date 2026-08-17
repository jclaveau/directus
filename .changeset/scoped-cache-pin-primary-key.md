---
'@directus/types': patch
'@directus/api': minor
---

Pin the primary key as a scoped-cache axis on every collection, with no configuration. `readOne(collection, key)` — and any read whose filter bounds the primary key with `_eq`/`_in` — is now tagged with that row's slice instead of the collection's bare tag, so a write to a sibling row no longer drops it. The purge side emits the same slice for every mutated key, on every collection, whether it declares `scoped_cache_fields` or not: the two sides have to agree, or a pinned read would never be purged. It costs no extra query, since the keys are already in hand, and it cannot go stale on an insert — an inserted row carries a different key, so it can never join a bounded read's result set.

Two behaviour changes to note. A deployment with no scoped collections at all now emits one tag purge per written row, where it previously emitted only the collection's bare tag — cheap per row, but a 1,000-row batch update goes from ~1 tag operation to ~1,001. And `context.scopedCache.purgeForMutatedRows(collection, rows)` now requires each row to carry its primary key: a row handed over without it degrades to a collection-wide purge (fail-safe, never stale) exactly as a row missing a declared scope field already did.

Reads that bound no key are unaffected: an unfiltered list read, and a read that embeds the root collection again through a self-referential relation, both keep the bare collection tag.
