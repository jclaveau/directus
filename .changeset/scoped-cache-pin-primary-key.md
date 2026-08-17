---
'@directus/types': patch
'@directus/api': minor
---

Pin the primary key as a scoped-cache axis on every collection, with no configuration. `readOne(collection, key)` — and any read whose filter bounds the primary key with `_eq`/`_in` — is now tagged with that row's slice instead of the collection's bare tag, so a write to a sibling row no longer drops it. The purge side emits the same slice for every mutated key, on every collection, whether it declares `scoped_cache_fields` or not: the two sides have to agree, or a pinned read would never be purged. It costs no extra query, since the keys are already in hand, and it cannot go stale on an insert — an inserted row carries a different key, so it can never join a bounded read's result set. A read that bounds no key is unaffected: an unfiltered list read, and a read that embeds the root collection again through a self-referential relation, both keep the bare collection tag.

Alongside it, three fixes the axis depends on or exposes:

- `GET /items/:collection/:pk` never forwarded the read's scope pins to the responder, so it fell through to the bare-collection fallback — the canonical read was unpinnable no matter what the service computed. It dropped the read's unautopurgeable tags too, meaning that route could cache a response the anomaly gate exists to refuse.
- Scope tag values now canonicalize their **spelling**, not just their type. A `uuid` is lowercased, and an `integer`/`bigInteger` loses surrounding whitespace, a leading `+` and leading zeros. Neither side normalized before, so `GET /items/x/07D1AF3C-…` pinned one key while `PATCH /items/x/07d1af3c-…` purged another — the same row, the same slice, two tag keys, and a stale HIT between them. Integer normalization stays string surgery so precision past `MAX_SAFE_INTEGER` survives; `string` keys are deliberately left alone, since a varchar key really is a distinct value.
- `flushCaches()` now drops the scoped-tag index, matching what the `response` flush target already did. Its callers — the migration runner and the build-identity self-heal on a code-only deploy — used to leave every tag SET behind pointing at keys they had just deleted.

Two behaviour changes to note. A deployment with no scoped collections at all now emits one tag purge per written row, where it previously emitted only the collection's bare tag — cheap per row, but a 1,000-row batch update goes from ~1 tag operation to ~1,001. And `context.scopedCache.purgeForMutatedRows(collection, rows)` now requires each row to carry its primary key: a row handed over without it degrades to a collection-wide purge (fail-safe, never stale) exactly as a row missing a declared scope field already did.

Cached entries written before an upgrade sit under the old spelling, but they need no operator action: the build-identity self-heal flushes the response cache on the first boot of a new build.
