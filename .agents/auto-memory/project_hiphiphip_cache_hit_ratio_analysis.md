---
name: project_hiphiphip_cache_hit_ratio_analysis
description: planner cache low hit/fill on /items/student_time_slot = query-shape variance, not a broken cache; 3 domain callers in apps/domain + @directus/sdk aggregate() drops top-level filter/limit (bug); filed as Planner issue #669
metadata:
  type: project
---

Prod cache telemetry (cache-stats, fork feature) on the planner: `/items/student_time_slot` runs ~20% hits (08-01: 1 763 hits / 6 884 misses / 6 884 fills / 3 387 distinct keys). The cache itself is healthy — fills==misses, `evicted_keys=0`, no deploy flush. Misses come from **query-shape variance**: most fills land on near-unique cache keys (key = hash of version·user·path·query).

**Three fill drivers (domain fns in `planner_2/apps/domain/src`):**
1. `listPositionOfSpacedRepetitionTimeSlots` (revising/spaced-repetition/front) — `course_part: {_in: [hundreds of ids]}` changes every request → 2 094 fills / 1 012 keys/day (~30% of all fills). Fix = stable key (canonical id-list / per-course_part fetch).
2. `listCoursePartTimeSlots` (revising/front) — stable per-ID `_eq` key yet ~18–31 misses/id: the value is actively **purged** (tombstone `scalabus:stats:tomb:*` present, value gone, no writes/eviction/deploy) — scoped-cache purge kills the bare `student_time_slot` tag on ~19 related `student_review_round` writes/day.
3. `hasEnoughTimeSlotsToEnableCompanionAutomatically` (funkify/front) — **BUG**: passes `filter`/`limit` at the TOP level of `aggregate()` options; the SDK command only forwards `options.query` (`aggregate.js`: `params: {...r.query, aggregate}`) → filter+limit silently dropped → global no-filter count (`{"fields":["*"],"aggregate":{"count":["*"]}}`, 339 fills/203 keys) AND the companion auto-enable check counts ALL time slots, not the student's. Fix = move filter/limit under `query: {...}`.

**How to apply:** continue from https://github.com/the-HipHipHip/Planner/issues/669 (filed 08-03, labels bug+enhancement). Recurring SDK gotcha: `@directus/sdk aggregate(collection, {aggregate, query})` — `filter`/`limit` MUST be inside `query`, never top-level.

Also seen in telemetry: an external client (not in either repo) sends a GraphQL **"Probes"** query — aliased `<collection>` + `<collection>_aggregated { group countAll }` over pathway/pathway_group/enrollment/course — a row-count/readability probe; each run is a cached GraphQL entry.
