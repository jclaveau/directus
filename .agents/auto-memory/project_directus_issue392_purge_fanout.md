---
name: project_directus_issue392_purge_fanout
description: Issue #392 — a purge emits one tag per key since #358, so a large failed purge cannot even be recorded; my reco is a bound at tag PRODUCTION, N measured from the redis crossover, awaiting jean's call
metadata:
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
