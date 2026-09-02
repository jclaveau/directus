---
name: project_directus_cache_stats_prod_incident
description: measured 2026-08 production cache-stats telemetry loss on hiphiphip — the 0x00 escaping drops (483 batches / 75k events) AND the far bigger 55h autokill blackout (~2.2M events); corrects #372's wrong "since #370" causality
metadata:
  type: project
---

Two independent holes in the planner's cache telemetry, measured from Railway
`Backend` (production) logs + read-only prod SQL on 2026-08-20.

**Hole A — the `0x00` escaping bug (fixed by #372).** 483 dropped batches /
**75,232 events**, `2026-08-15T01:22:31Z` → ongoing at the time of measuring. All
`directus_scoped_cache_purge_tags`, all `invalid byte sequence … 0x00`. Against
events that persisted the same days: **1–2%** (2.20% worst day). 24 batches sit
exactly at the 500-event chunk cap from #356, so 75,232 is a floor.

- **#372's body claimed this started "since #370 shipped" — WRONG, and I corrected
  the body in place.** #370 merged `08-20T01:40Z`; the first drop is five days
  earlier. Deployment `864e6d11` (08-11→08-15) has ZERO drops across 2,567
  fully-retained lines, so the boundary is real, not log retention.
- Real cause: the purge path queues its tag **without touching a response header**,
  so #370's header escaping never gated it. `directus_cache_purges` and
  `purge_tags` both start `2026-08-15 01:22:03.874` — 27s before the first drop.
  It broke the moment the purge tables shipped.

**Hole B — the autokill blackout (~29× bigger).** `CACHE_STATS_MAX_BYTES` was
512 MiB; `directus_cache_events` tripped it and capture latched OFF for **55 hours**
(`08-17T19:42:16` → the `08-20T02:00` deploy carrying #369's `2gb` default):

```
[cache-stats] auto-disabled — autokill: table 536895488B > 536870912B
```

0 events on 08-18, 266 on 08-19 — while `purge_tags` wrote 1.81M and 1.85M rows
those same days, because `queueCachePurge` is deliberately exempt from the flag.
~**2.2M events** lost. Filed as **#375** (jean's ruling: autokill must block EVERY
emitter, all stats tables follow the same rules as `cache_events`) and **#376**
(the budget measures only the smallest table).

**How to apply:** any hit-ratio reading for 08-18/08-19 is *absent*, not low; the
08-15→08-17 and 08-20 readings are only 1–2% light.
[[project_hiphiphip_cache_hit_ratio_analysis]] predates the window and is unaffected.
See [[project_directus_cache_stats_table_roles]] and [[project_planner_directus_dist_pin]].
