---
name: project_directus_pr353_accepted_exceptions
description: PR #353 cache purge events + per-entry purge attribution — decisions already settled with jean; do NOT re-raise them in a fresh review
metadata:
  type: project
---

PR #353 (`v11.10.1-feat/cache-purge-events` → `v11.10.1-hhh-dev`) records scoped-cache purges and attributes them per entry. **Settled — a clean session must not re-flag:**

- **`directus_cache_purges` is its OWN table, not a kind on `directus_cache_events`.** jean: *"keep separate table."* Reasons: different grain (a purge is not a served request and has no `cache_key`, which `listCacheEntries` inner-joins on without filtering kind), the numeric columns there are all named for durations, and the events table is a Timescale hypertable with `compress_segmentby='kind'` — altering it means an ALTER against compressed chunks.
- **`mode: 'namespace'` stays separate from the `flush` config-event marker**, though both mean "the whole cache went". `recordCacheConfigEvent` is a direct **unbuffered INSERT** — fine for an operator flushing by hand, ruinous on a path that fires per mutation. Distinct events on purpose: operator action vs automatic invalidation.
- **`entry_tags` has no time dimension**, so the per-entry count includes purges predating the current fill. Deliberate: `cache_key` is stable across refills, so those purges killed earlier incarnations of the same request — that IS the churn being measured.
- **The blackbox proves "not a global counter", not tag-level isolation** — `collectionIgnored` sits in `CACHE_AUTO_PURGE_IGNORE_LIST`. Tag-level isolation is covered by unit tests instead.
- **No `id` on the fact tables** — a hypertable refuses a unique index that omits its partitioning column, so an `id` PK would have to be `(id, time)`. This is why boot warns "doesn't have a primary key column".
- **Coarse purges attribute by COLLECTION, not by the bare tag.** A pinned read carries only its slice tag (`articles:owner=7`), never the bare one (`scoped-cache-purge.test.ts:427`), so matching the bare tag would miss every pinned entry — most of what a coarse purge destroys.

**Still open at handoff:** the summary-tile question (a Purges tile may be redundant now), and #350's retarget (merge `hhh-dev` into it first or its diff re-shows all of #349) — deferred until #353 merges.
