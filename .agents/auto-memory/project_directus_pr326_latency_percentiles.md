---
name: project_directus_pr326_latency_percentiles
description: PR #326 cache-tree response-latency percentiles — design decisions and the points jean already settled, so a fresh review doesn't re-litigate them
metadata:
  type: project
---

PR #326 (branch `v11.10.1-feat/cache-hit-ratio` → `v11.10.1-hhh-dev`): rank the cache
tree by what a miss COSTS, not just by counts.

**Design:**
- `GET /utils/cache/latencies` — `percentile_cont` with **two GROUPING SETS in one
  pass** (`(path,method,query)` for query nodes, `(path)` for the endpoint rollup), so
  each level aggregates its OWN raw events. A rollup of a child's percentiles is not a
  percentile. `GROUPING(d.method)` disambiguates a rolled-up null from a real one.
  Postgres-only like `recommendedTtlMs`; other dialects → `[]`, tree shows no durations.
- Five metrics, same kind filters as the chart: `response` 0/2/3/4, `miss` 2/3/4,
  `anomaly` 3, `fill` 2, `hit` 0.
- Tree row = the funnel (responses → misses → anomalies → fills → hits), each column a
  count beside that metric's median; colour is the legend, name+count+p50/p95/p99 in a
  `v-tooltip` (not `title` — no tab-focus requirement).
- Toolbar: metric select, **band** select, sort select+direction. The band is a
  **cross-branch** percentile — `p99` keeps the slowest 1% of branches, p95 the 5%,
  p50 the half; `All` disables it.

**Settled — do NOT re-raise:**
- Summary tiles stay in their old order (not funnel order) — jean scoped the reorder to
  legends/tree/selects.
- The band cuts **endpoints only**; a surviving endpoint keeps all its query rows.
- Branches with no timing in the window are dropped while a band is active.
- The ratio curve's hidden axis is `0..115`, deliberate headroom so a 95-100% cache
  doesn't clip its stroke on the plot's top edge.
- `Fills` and `Misses` stay separate metrics even though they coincide on jean's data.
- A stored sort field from another metric survives a reload (the `watch` has no
  `immediate`) — known, self-heals on any metric change, left alone as behavioural.

Related: [[project_directus_cache_admin_page]], [[project_directus_server_info_cache_mode]].
