---
name: project_directus_pr353_accepted_exceptions
description: the cache-purge telemetry (merged PR #353) — decisions already settled with jean, the naming in force, and the two UX questions still open; do NOT re-raise the settled ones
metadata:
  type: project
---

**MERGED 2026-08-12** as squash `79232cf73f` ("feat(cache): record what a purge took, and read it beside the hits (#353)"). The page reads purges beside hits, which is the only place the number means anything.

**Naming in force on this page (renamed late, so older notes and screenshots lag):**
- **Hit Score / Purge Score**, not "ratio" — the figure is a signed balance (−100%…+100%). `scoreTitle`, `scoreOf`, `ScoreAgainst`, `.stat.score`, keys `cache_hit_score` / `cache_purge_score` / `cache_score_*`. Deliberately NOT renamed: `hitRatioPercent` / `node.hitRatio` (the share that backs sorting, never rendered) and the sort field's stored value `'ratio'` (per-user localStorage — renaming drops saved sorts).
- **`Purges` = purge OPERATIONS; `Purged entries` = what they evicted.** Both plot on counts row 1; `Coarse purges` (row 2) is a subset of the former. The summary tile shows `Purged entries`. Tile and tree column measure the same quantity at two grains and cross-check.
- Scoped cache tags carry the full radical: `directus_scoped_cache_{entry,purge}_tags`, column `scoped_cache_tag` / `scoped_cache_tag_count`. The *purge* level stays on `Cache` (`directus_cache_purges`, `queueCachePurge`, `CachePurgeMode`) because mode `namespace` fires from the non-scoped path.

**Still open (jean's call, both raised and left):** whether the Purge Score tooltip should keep naming its denominator "Purges" now that the word means operations; and whether the longer "Purged entries" tile label sits well in a real browser (only ever seen in jsdom). Out of scope by decision: `tagCounts` on the entry-detail endpoint and the `__tags` Redis sidecar keep their bare-`tag` names — they predate the PR.

**Settled — a clean session must not re-flag:**

- **`directus_cache_purges` is its OWN table, not a kind on `directus_cache_events`.** jean: *"keep separate table."* Reasons: different grain (a purge is not a served request and has no `cache_key`, which `listCacheEntries` inner-joins on without filtering kind), the numeric columns there are all named for durations, and the events table is a Timescale hypertable with `compress_segmentby='kind'` — altering it means an ALTER against compressed chunks.
- **`mode: 'namespace'` stays separate from the `flush` config-event marker**, though both mean "the whole cache went". `recordCacheConfigEvent` is a direct **unbuffered INSERT** — fine for an operator flushing by hand, ruinous on a path that fires per mutation. Distinct events on purpose: operator action vs automatic invalidation.
- **`entry_tags` has no time dimension**, so the per-entry count includes purges predating the current fill. Deliberate: `cache_key` is stable across refills, so those purges killed earlier incarnations of the same request — that IS the churn being measured.
- **The blackbox proves "not a global counter", not tag-level isolation** — `collectionIgnored` sits in `CACHE_AUTO_PURGE_IGNORE_LIST`. Tag-level isolation is covered by unit tests instead.
- **No `id` on the fact tables** — a hypertable refuses a unique index that omits its partitioning column, so an `id` PK would have to be `(id, time)`. This is why boot warns "doesn't have a primary key column".
- **Coarse purges attribute by COLLECTION, not by the bare tag.** A pinned read carries only its slice tag (`articles:owner=7`), never the bare one (`scoped-cache-purge.test.ts:427`), so matching the bare tag would miss every pinned entry — most of what a coarse purge destroys.

**Still open at handoff:** the summary-tile question (a Purges tile may be redundant now), and #350's retarget (merge `hhh-dev` into it first or its diff re-shows all of #349) — deferred until #353 merges.
