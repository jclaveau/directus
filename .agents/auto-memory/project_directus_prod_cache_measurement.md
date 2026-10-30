---
name: project_directus_prod_cache_measurement
description: measured production Redis for the scoped cache (2026-08-26) — sizes, the 130 B/member cost, the effective CACHE_TTL of 48h that contradicts the env file, and why zero pk-shaped tags does NOT mean #358 is absent
metadata:
  author: Jean Claveau
  type: project
---

Read-only probe of a prod consumer's Redis, `scalabus` namespace, 2026-08-26
(how to reach it: the consumer repo's memories).

| | |
|---|---|
| keys / used memory | 270 127 / 218.73 MB |
| `maxmemory` / policy | **0 / `noeviction`** |
| scoped tag keys | 21 314 (53 bare, rest value slices) |
| slice indexes | 11, largest 3 179 members / 414 KB, ~1.6 MB total |
| **cost per index member** | **130 B** |
| observed tag-set TTL | 345 600 s (96 h) |

**Effective `CACHE_TTL` is 48 h, not the `1h` in the consumer's env file.** A tag set
expires at `SCOPED_CACHE_TAG_TTL_FACTOR` (2) x the cache TTL, and 345600/2 = 172800 s.
Almost certainly a durable override in `directus_settings`, which `resolvedCacheTtl()`
reads BEFORE the env. Filed in the consumer repo.

**Zero primary-key-shaped tags does NOT mean #358 is absent — it IS in production.**
Every prod read filters on a declared scope path (relational paths
ending in a user field), so the implicit pk pin has nothing to bind to. I read the
absence as "not deployed" and jean corrected me. See
[[feedback_failed_probe_may_be_invalid_not_refuting]].

Related: [[project_directus_cache_stats_prod_incident]], [[project_directus_cache_ttl_rules]].
