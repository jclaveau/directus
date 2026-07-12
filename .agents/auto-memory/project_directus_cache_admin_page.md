---
name: project_directus_cache_admin_page
description: PR #227 cache-stats admin page + Postgres/Timescale TTL-tuning telemetry — current architecture, the accepted design decisions (don't re-raise in a fresh review), and the Directus gotchas that shaped it
metadata:
  type: project
---

Settings → **Cache** page (`app/src/modules/settings/routes/cache/`), PR **#227**, branch `v11.10.1-feat/cache-stats-page` (base `v11.10.1-hhh-dev`). NOTE: the original Redis `:entry:` sidecar registry (cache-registry.ts, recordCacheHit/registerCacheEntry, Lua HINCRBY) was **removed this session** and replaced by the Postgres telemetry below.

**Pipeline.** Hot path buffers to a Redis stream (`XADD`), a synchronized schedule flushes to two tables:
- `directus_cache_events` (fact, Timescale hypertable + compression `segmentby kind` + 90d retention): `age_ms` (hit age), `gap_ms` (miss time-past-expiry via a tombstone), `ttl_ms`, `duration_ms` (hit serve latency).
- `directus_cache_descriptors` (dimension, one row/key, reaper-pruned not retention): method/path/collection/user_id(m2o→users)/query/url/bytes + `fill_ms` (miss compute cost). Registered **system** collection (`accountability: null`).
- Captured in `cache.ts` (HIT) + `respond.ts` (fill). `res.locals.requestStart` stamped at cache-mw entry = the one timing reference for both.

**Page.** Tree = **path → method+query → cache item** (`buildGroups`→`QueryGroup`→entries), rows paginate 25/page. Row-click → `v-drawer` with descriptor cols + live Redis via `GET /utils/cache/entry?key=`: value, scoped-cache tags (`__tags` sidecar, SCARD blast-radius `articles:id=5 (12)`), `__expires_at` timestamps, tombstone, compressed/raw size, **recommended TTL**. Endpoints: `GET /utils/cache` (list), `/utils/cache/entry`, `DELETE /utils/cache?key=|path=`, `GET/PATCH/POST /utils/cache/stats`.

**Recommended TTL** = p95 of the re-request age distribution (hit ages ∪ near-expiry miss ages `ttl+gap`, cold misses excluded) via `percentile_cont` in `listCacheEntries`. Verdict shorten/lengthen/ok at ±25%. Group aggregate = **max** across sibling keys.

**Directus gotchas that shaped it:**
- `/items/directus_*` is FORBIDDEN → no native server-side filter on the descriptor system collection; page filters **client-side** (`filter-entry.ts` `matchesFilter`, m2o `user_id.email` drill-in recursion). [[reference_directus_items_forbids_system_collections]]
- `percentile_cont` is Postgres-only → recommended-TTL select gated `if (db.client.config.client === 'pg')` (blackbox also runs sqlite3); plain-DB → null.
- HIT = `res.json(...)` → content-type always JSON, never stored.
- `directus_collections.meta.accountability` defaults `'all'` (activity+revisions); `null` turns both off.

**Accepted decisions — settled, do NOT re-raise in a fresh review:**
- **Content-type omitted** — HIT is always `res.json`, a dead field.
- **Client-side filter** — forced by the `/items` system-collection ban, not a shortcut.
- **TTL model = p95 re-request age, ±25% band** — 0.95 and 0.25 are the tunable knobs.
- **Group TTL aggregate = max** across siblings.
- **fill_ms/duration_ms ride the existing unreleased migration** — no new migration file.
- **Component-mount test** (`cache.test.ts`, hyphenated tags as custom elements + real stubs for search-input/private-view/v-pagination) is atypical for this repo (no other page is mounted) but needed for SFC glue to hold blocking `codecov/patch` ≥95.

Related: [[project_directus_codecov_flags]], [[project_directus_scoped_cache_design]], [[project_directus_env_type_map]].
