---
name: project_directus_issue531_composite_tags
description: Issue #531 composite scoped-cache tags (fingerprints) — grammar, DNF bounds, index layout and the rulings already settled with jean
metadata:
  type: project
---

Issue #531: an entry carries a SET of tags and dies on ANY match, so a composed
path over a shared column behaves as a global tag (prod hit ratio ~35% → ~5%).
Fix: ONE composite tag — a *fingerprint* — per collection a read touches.

Grammar: `<collection>:&<key>=,<v1>,<v2>,&<key2>=,<v>,&`. `&` is AND between
pairs, comma-wrapped values are OR inside a pair, `view=` (the selected fields) rides as a pair,
bare is `<collection>:&`, `\x00null` is the null sentinel, and `\ , & |` are
escaped. Index: `<ns>:scoped-cache-index:fingerprint:<collection>:<indexPath>=<value>` SETs
holding `"<fingerprint>|<cacheKey>"`, plus a bare `''` bucket. NO legacy `tag:`/`slices:` double-write exists any more
(verified 2026-09-26: nothing in api/src outside migrations writes or reads them) —
pre-deploy entries rely on CACHE_AUTO_FLUSH_ON_DEPLOY.

**Bounds (DNF).** The legacy tag list is a pure UNION — purging drops an entry as
soon as a write reproduces any ONE tag — so ANDing a collection's tags into one
fingerprint is stale-unsafe. A *bound* is the set of tags that had to hold
together. `_and` merges pairs into one bound, `_or` adds alternatives, each bound
is filed as its own index member, capped at `SCOPED_CACHE_MAX_FILTER_BOUNDS = 16`
and degrading to bounds side by side (a wider purge) above the cap. Only the ROOT
filter produces multi-pair bounds; every other tag stands alone.

Rulings jean settled (do NOT re-raise):
- OR pins → **file one fingerprint per OR branch**, not a merged bound.
- `fields=` narrowing → **keep it**, and rewrite the existing bb assertions that
  encode the old over-purge (the one authorized exception to "don't change the
  existing bb tests").
- retry timer → **move the test's poison to the index bucket**
  (`…:fingerprint:<coll>:`), since recovery replays the recorded purge over the
  fingerprint index sets.
- Telemetry column name → **keep `scoped_cache_pin`** (ruled 2026-09-25), do not
  revert to `fingerprint`. The `*_entry_pins` / `*_purge_pins` rows hold ONE pin
  (`collection[:field=value]`, `''` = collection-wide purge), never a
  fingerprint. The purge-coverage join is an equality on pins, since a read's
  fingerprint carries `viewFields` and a write's cannot, so fingerprints would join
  0 rows. Coverage is therefore a reach (an upper bound), not an eviction count.
- The `Map`s → **keep them as they are, no alias** (ruled 2026-09-25). The 15
  `Map<string, Set<unknown>>` in `read-pins.ts` mean the same as
  `pinnedScope`, but they hold raw values (not yet canonical) and are merged in
  place, so they are not a `pinnedScope`. The other Maps hold different data.
- A pinned field counts as bound even when the read did not select it, but only
  beside declared fields — a fingerprint with pairs and no `view=` still means
  every field.

Two gaps the blackbox suite found once the fingerprints were live, both fixed:
a nested collection was bound only to the columns the read selected of it, so a
row rewritten onto another parent (a change of WHICH rows, on a column the read
never shows) left the entry cached — the reverse fk of every to-many the read
descends now joins its bound fields (`scopedCacheNestedRowBindings`); and the
index purge ignored `includeCollectionTag: false`, dropping the pairless
fingerprints that opt-out exists to keep warm (`/users/me/track/page`).

Reading the real fingerprints is cheap: run the api from source on :8155 with
`CACHE_STORE=redis` against the blackbox redis (6108) under its own
`CACHE_NAMESPACE`, then `redis-cli --scan --pattern '<ns>:scoped-cache-index:fingerprint:*'`
and `smembers`. The member is `<fingerprint>|<cacheKey>`, so what a read bound
itself to is readable directly — far faster than a blackbox round trip.

Deviations from the issue's sketch: no Redis globs / 64-glob cap (the
match is a substring test over a serialized row), no Lua for the index purge
(SSCAN paging + node-side matching, so #365 recovery, #353 telemetry and #392
bounds all survive). "No Lua" was
Claude's implementation choice, NOT a jean ruling — never cite it as one (the
legacy sweep already runs Lua in `redis-store.ts`).

**Purge/refill race + leftover members → issue #547** (filed 2026-09-26, from
code reading, not reproduced). A purge SREMs only the members it matched: an
entry's other members outlive it, and a refill that starts after the bump can
have its identical member SREMed → cached entry missing a trigger → stale.
Atomic DEL+SREM does NOT fix it. Proposal: member `<fingerprint>|<cacheKey>|<epoch>`,
purge skips epoch ≥ its INCR reply, then a reverse index drops all members.
Ruled 2026-09-26: #547 lands AFTER #534 merges (#534 ships with the race). Open: expired-counter (`null`) rule. The #534 bb scenario "a write to a parent
purges the reads selecting through it…" states the leftover `alpha_part` pin
with a comment linking #547 (commit cc7bca66d2).

## Caps are PARKED to the END of PR #534 (jean's ruling, restated 2026-09-22)

Three caps are identified and agreed in principle; none is built, and the
measurements they need are parked with them. Do not implement one mid-PR:

- `SCOPED_CACHE_MAX_QUERY_CASES = 16` — cartesian of AND over OR. Already on the
  branch; revisit at the end, once we know it is needed.
- 64 globs — #531's match-side bound, arrives with the glob conversion.
- rendered size / values per pair — one fat `filter[id][_in]` inflates every
  index member and every pattern. Needs a measurement of real `_in` widths in
  prod before a number is picked.

No Redis limit forces any of them: a member's hard ceiling is 512 MB and the
`set-max-listpack-value` cliff (64 B) is already crossed by every fingerprint.
The real pressures are memory (~130 B per index member measured, 270k keys),
glob cost (pattern length x members scanned), and — the only structural limit in
the system — Postgres's 65 535 bind parameters, which is what #392 caps.

Any size cap degrades WIDER, never narrower: drop whole pairs (widest first,
down to the bare `collection:&`), never truncate a pair's value list. A dropped
pair over-purges; a truncated value list leaves the read pinned to values it no
longer names and never purges them -> stale.

Related: [[project_directus_scoped_cache_tag_derivation]],
[[project_directus_scoped_cache_pin_soundness]],
[[project_directus_pr402_accepted_exceptions]],
[[project_directus_issue392_purge_fanout]].
