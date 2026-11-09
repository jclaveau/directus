---
name: project_directus_issue617_parked
description: Issue #617 (blackbox lock between schema-moving files) is PARKED - not a flake source; pick up only when a schema-wide assertion test is written
metadata:
  type: project
---

#617 proposes a per-shard mutex for blackbox files that move the schema. Parked by jean 2026-11-09 (comment issuecomment-6739885462).

Measured 2026-11-09 over 58 failed blackbox runs / 88 failed shards since 2026-10-20: the stale-hash 400 appears in 2 shards, only as a server DEBUG line; `write-path-apply-diff`'s `retry_stale_hash` (from #614) absorbed it, and 0 shards failed on it.

**Why:** the only remaining gain is letting a test assert something schema-wide (snapshot, field count) in the parallel middle; none exists yet.
**How to apply:** don't propose #617 as a flake fix. Reopen the work when the first schema-wide assertion test is written. The flakiest file in that window was `tests/common/assets/concurrency.test.ts` (13/88 failed shards, not yet split by branch).
