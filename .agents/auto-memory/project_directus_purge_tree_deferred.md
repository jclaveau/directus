---
name: directus-purge-tree-deferred
description: Filtering the SLOWEST PURGES needs its own tree keyed by collection/scope — the endpoint tree can't host it; deferred out of PR #353
metadata:
  type: project
---

Jean wants to **filter the slowest purges**. Deferred — not in PR #353. Do not
build it into the endpoint tree, and do not add `Purges` to that tree's latency
metric dropdown.

**Why the endpoint tree can't host it:** its row is an endpoint; a purge is not
one. `directus_cache_purges` has no endpoint column and cannot get one — a purge
fires once per mutation and covers whatever entries carry its tags, across many
endpoints. Attributing its `duration_ms` to endpoint rows prints the same reading
on every row it touched, so it neither sums nor ranks. Sorting that yields
"endpoints near slow purges", not slow purges. Same reasoning as
[[feedback_metric_granularity_decides_surface]] — a per-collection/scope measure
does not become per-row by division.

**The data is already stored**, all of it, since #353:
- `directus_cache_purges` — `time, collection, mode (slices|collection|namespace),
  tag_count, evicted, duration_ms`
- `directus_cache_purge_tags` — the tags each purge dropped, by `purge_id`

Today it only reaches `purgeP50/P95/P99` on the timeseries (one chart line,
window-wide), which shows purges got slow but never which.

**The shape proposed, if it gets built:** a purges tree whose row IS a purge
grain, nested on what jean confirmed a purge is keyed by — collection, then scope
tag, with the coarse/`collection` mode split called out (usually the slow one; it
scans every slice). Reuses the existing `All ▾` band control (`filterLatencyBand`).
Needs a `/utils/cache/purges` endpoint plus a page section.

**How to apply:** if a fresh session sees the metric dropdown lacking `Purges`,
that is deliberate — see [[project_directus_pr353_accepted_exceptions]]. Raise the
purge tree as its own PR after #353 lands, not as scope creep inside it.
