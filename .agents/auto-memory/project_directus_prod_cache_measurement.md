---
name: project_directus_prod_cache_measurement
description: measured production Redis for the scoped cache (2026-08-26) — sizes, the 130 B/member cost, the effective CACHE_TTL of 48h that contradicts the env file, and why zero pk-shaped tags does NOT mean #358 is absent
metadata:
  type: project
---

Read-only probe of the planner's production Redis, `scalabus` namespace, 2026-08-26.
Reached via `planner_2/apps/directus/data/redis_cli_railway.sh production <cmd>`
(`railway run --service Redis`, `REDIS_URL` injected). `db_query_railway.sh` REFUSES
production by design — do not edit that guard.

| | |
|---|---|
| keys / used memory | 270 127 / 218.73 MB |
| `maxmemory` / policy | **0 / `noeviction`** |
| scoped tag keys | 21 314 (53 bare, rest value slices) |
| slice indexes | 11, largest 3 179 members / 414 KB, ~1.6 MB total |
| **cost per index member** | **130 B** |
| observed tag-set TTL | 345 600 s (96 h) |

**Effective `CACHE_TTL` is 48 h, not the `1h` in `apps/directus/env/.env`.** A tag set
expires at `SCOPED_CACHE_TAG_TTL_FACTOR` (2) x the cache TTL, and 345600/2 = 172800 s.
Almost certainly a durable override in `directus_settings`, which `resolvedCacheTtl()`
reads BEFORE the env. Filed with the rest as **the-HipHipHip/Planner#727**.

**Zero primary-key-shaped tags does NOT mean #358 is absent — it IS in production.**
Every prod read filters on a declared scope path (`enrollment.student.user=`,
`student.user=`, `course=`), so the implicit pk pin has nothing to bind to. I read the
absence as "not deployed" and jean corrected me. See
[[feedback_failed_probe_may_be_invalid_not_refuting]].

Related: [[project_directus_cache_stats_prod_incident]], [[project_directus_cache_ttl_rules]].
