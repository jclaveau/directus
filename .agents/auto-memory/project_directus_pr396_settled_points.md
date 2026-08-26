---
name: project_directus_pr396_settled_points
description: PR #396/#398 (cache-stats eviction ring + table rename) — points jean already ruled on; do NOT re-raise them in a fresh review
metadata:
  type: project
---

Settled during review of **#396** (`drop the oldest telemetry instead of stopping
capture`) and **#398** (`one prefix for the whole subsystem`). A clean-session review
will want to re-flag several of these:

- **`directus_cache_stats_config_events` takes the `cache_stats` prefix** even though
  it is written whether collection is on or off. The prefix names the owning
  subsystem, not the write condition. I argued the other way first and withdrew.
- **`_scoped_purge_tags` / `_scoped_entry_tags` KEEP `scoped`** — every row is one
  scoped-cache tag, so the qualifier is true of the whole table. jean's rule: it goes
  only if the table is *not* exclusively about the scoped cache.
- **`directus_scoped_cache_pending_purges` is deliberately NOT renamed** — purge
  queue, a live mechanism, not telemetry, and not in the budget's table list.
- **The nightly 3AM reap is gone**, folded into the ten-minute
  `CACHE_STATS_RETENTION_SCHEDULE` job, in dependency order (facts → descriptors →
  entry tags). One variable, one job, on purpose.
- **`CACHE_STATS_MAX_BUFFER`'s default rose 100 000 → 1 000 000** to match the
  hardcoded MAXLEN it replaces. Not a typo.
- **Three upstream `_SCHEDULE` vars and 100 defaults were typed in `TYPE_MAP`** inside
  this PR rather than a separate one; jean asked for the sweep explicitly.
  Eleven exclusions are documented at the top of `type-map.ts` and are not an
  oversight — see [[project_directus_env_type_map]].
- **`eslint.config.js` registers the style plugin switched off** so a source line can
  carry `eslint-disable-line local/…`; unused-directive reporting is off in that
  block by design.
- **The planner-side env (`CACHE_STATS_RETENTION=3d`, `MAX_BYTES=1gb`, dropping the
  `512mb` pin) is jean's, after merge + Scalabus bump.** Out of scope here.

Still genuinely open at handoff: the `TODO(reviewer)` on `compress_orderby` for the
purge-tag hypertable (wants an `EXPLAIN` against a compressed chunk).
