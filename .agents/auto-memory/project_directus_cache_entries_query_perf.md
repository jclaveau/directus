---
name: project_directus_cache_entries_query_perf
description: Measured prod truth about listCacheEntries — never hit the statement timeout, the wide GROUP BY is NOT what spills, and the entries window default never reaches the admin page (refutes PR #377's diagnosis)
metadata:
  type: project
---

Measured on prod 2026-08-21 (`statement_timeout=60s`, `work_mem=32MB`, 1.83M events/24h,
64k/1h, 399k descriptors):

| shape | window | elapsed | spill |
| --- | --- | --- | --- |
| 13-column GROUP BY + join (current) | 24h | 4.6-5.3s | 125 MB |
| GROUP BY `e.cache_key` + semi-join (#377) | 24h | 4.2s | 124 MB |
| either | 1h | 0.5-1.2s | none |

- **It has never timed out.** `log_min_error_statement=error`, so a cancelled statement
  logs its own SQL; grepping the whole retention for `d.cache_key` finds nothing but my
  own probes. The 8 real timeouts in 18 days are all `student_time_slot` permission-CASE
  selects and `student_teaching_unit` updates.
- **The wide grouping key is not the spill driver** — 131 MB vs 130 MB, 1%. It is ~1.8M
  event rows at ~70 B against 32 MB `work_mem`. Restructuring buys ~10% and no spill.
- **The window is the only real lever — but the page never takes the default.**
  `cache.vue` always sends `?window=`, a per-user `useLocalStorage(..., '24h')` picker,
  and it is the only `GET /utils/cache` in the app. `DEFAULT_CACHE_ENTRIES_WINDOW`
  reaches only the MCP `list_cache_entries` tool and bare API/blackbox callers. So the
  page stays at 24h → 4.6s → 125 MB spill regardless of #377.
  (Had the page taken 1h it WOULD be a big content change: 168/200 keys swap, top row
  3826→168 hits, bottom 58→6; and 1h respills at ~7x current traffic.)
- The empty cache page on 2026-08-20 was a Railway partial deploy (Api deployed,
  Backend not), never a slow query. I reasoned row-counts→timeout instead of grepping
  for one; PR #377's body now carries the correction above the fold.

**How to apply:** before touching a cache-stats query for speed, grep the PG log for the
statement first ([[reference_railway_log_forensics]], read-only recipe in
[[reference_pn_db_query_local]]); `temporary file: ... size N` lines are the spill
evidence and they attribute it per-pid.
