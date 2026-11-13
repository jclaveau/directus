---
name: project_directus_issue392_purge_fanout
description: Issue #392 — a purge emits one tag per key since #358, so a large failed purge cannot even be recorded; my reco is a bound at tag PRODUCTION, N measured from the redis crossover, awaiting jean's call
metadata:
  author: Jean Claveau
  type: project
---

Filed 2026-08-25 as **#392**, open. Since #358 pins the primary key on every
collection, fan-out scales with rows written (old ∪ new), where an unscoped collection
used to carry one bare tag.

**Three coupled defects:**

- `recordPendingScopedCachePurge` inserts one row per tag, 6 columns → past **10 922
  tags** it exceeds the pg bind limit ([[reference_pg_bind_parameter_limit]]), throws,
  and the catch swallows it into a `warn`. The record is lost in exactly the case the
  table exists for: a bulk write during an outage.
- `clearPendingScopedCachePurges` / `countFailedScopedCachePurgeRetry` use unbounded
  `whereIn('id', ids)`, and the drain's catch reuses the same list — a target above the
  ceiling can never clear. Ids accumulate per target across an outage, so **no
  per-purge bound fixes this one**.
- Runtime: N × (`SMEMBERS` + `DEL` + `SREM`) per purge.

**My recommendation (in the issue, not yet accepted):** bound where tags are PRODUCED,
not where they are recorded — above N keys `snapshotScopedCacheTags` returns `null`,
which the existing path already turns into `purgeCollectionScopedCache`. Pick N from
the measured redis crossover (one collection purge vs N slice purges), not from the
bind limit; the ceiling then becomes unreachable as a side effect. Plus: dedup the
recorded labels (`scoped-cache.ts:1018` records raw while the purge dedups at `:1008`),
clear by target predicate with an `id <= maxSeen` guard, and keep a coarse fallback
with `logger.error` if even that cannot be written.

**Open, jean's call:** what N is, and whether losing a whole collection's cache above it
is acceptable for bulk writes. If the crossover measures high, the honest answer may be
to leave the fan-out alone and fix only the recording ceiling.

**Ruled out — do not re-propose:** raising a 500 when the record cannot be written. The
mutation has already committed, so a 500 makes a client retry a durable write and
duplicate rows. Loudness belongs in a log/alert, not the response.

## 2026-09-30 — re-analysis after #574 merged (branch `v11.10.1-perf/purge-fanout-bound`, worktree `../purge-fanout-bound`, base 6dabc72e22)

**Jean's priority (I got it backwards first):** the MAIN goal of #392 is the bench
item #574 left out of scope — the `fan` fill shape (`/items/notes?...&limit=200&fields=*,author.*`,
200 distinct author pins) costs **446 redis commands/request** (ceiling 500 ratchet,
absolute target 7 over `off`). The record ceiling is a separate small correctness fix
(dedupe, one coarse `collection` row above N≈1000, clear by predicate + `id <= maxId`);
split it into its own issue/PR or a side commit.

**Findings:** ceiling ≈5 400 rows/write (12 000 fingerprints × 6 cols); drain's
`listPendingScopedCachePurges` dedups with `includes` in a loop = O(n²) (70k → 2.4e9
compares, blocks boot); a retry already scans the whole collection (`indexPath = null`),
so coarsening the record costs ~nothing extra. Anything filing each key in its own set
costs ≥1 command/key, so target 7 is approachable only by coarsening.

**Fill-side designs:** F1 coarsen past N pins (`CACHE_SCOPED_MAX_PINS_PER_COLLECTION`,
default 250; bench's 200 pins sit just under it) — write side then reads the bare set
(#534 shape); F2 bucketed pin sets (hash mod B=8); F3 drop per-set TTL bookkeeping
(446→~220, leans on the reap commit d0e76b502e which is on the composite-tags branch,
not trunk); F4 ranges/patterns (#419) out of scope. **Reco:** F1, measure first with no
code change — N sweep 250/64/16/4 over `cache` bench (fan fill commands) and
`purge-scaling` (slowest command, HIT under writes); F2 only if write side degrades.

**Status:** jean said do all measures in CI first. Dispatch-only sweep job (gates
nothing) pushed as 8daed8dc66; run 36748721318. Next: read the tables, pick N.
Open questions still to jean: N as env var vs constant, deterministic failures
(WRONGTYPE/NOPERM/READONLY) separate issue, drain shortcut.

**2026-09-30 rulings + result (branch v11.10.1-perf/purge-fanout-bound, 47b16f864c, no PR yet).**
Sweep (run 36748721318): fan fill 435 cmds at cap 250 vs 8 at 4..64; write over 1600
fan reads evicts 153 (key pins) vs 200 (slice) vs 1600 (bare). jean chose **default cap
64, both fallbacks**. Cache bench on branch: scoped fan fill 446.5 → 31.1 cmds, 57.1 → 12.8 KB.
jean chose **retarget + ratchet**: target 7 was unreachable (commandstats counts Lua-internal
TTL/SADD/EXPIRE, ~3 per index set); scoped fill held to 11 (measured 10.98, exact counts),
scoped fan to 11 + 3×9 = 38, ratchet 35 cmds / 15 KB. Bench + Check green. Blackbox NOT run
(needs a PR + label). Record-ceiling fix (design A) still unscheduled.
