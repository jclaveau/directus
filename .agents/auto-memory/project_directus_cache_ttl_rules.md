---
name: project_directus_cache_ttl_rules
description: PR #279 (PARKED draft) — per-path/method/query-shape cache TTL rules replacing the single global CACHE_TTL; architecture + accepted design decisions so a fresh review doesn't re-litigate the descriptor-table-vs-rules-store call
metadata:
  type: project
---

PR **#279** — https://github.com/jclaveau/directus/pull/279, branch `v11.10.1-feat/cache-ttl-rules`, base `v11.10.1-feat/scoped-cache-derived-paths` (**stacked** — needs that branch's `respond.ts` scoped-cache fill block: `tagScopedCacheKeys`/`__tags`). **DRAFT, deliberately PARKED** by jean this session — designed + drafted, not to be finished now.

**Built in a worktree** `../directus-cms-2-wt-cache-ttl` (off committed HEAD `4d745b124f`, NOT the dirty main tree which has untracked cache-registry WIP). Resume there. Main tree untouched, no `.agents`/WIP dragged into the commit (3 files only).

**Problem.** One global `CACHE_TTL` (default `5m`) applied to EVERY cached response (`respond.ts` — 5 call sites all `getMilliseconds(env['CACHE_TTL'])`, incl. the CDN `Cache-Control` header). `CACHE_SYSTEM_TTL` is separate but also fixed.

**Key insight (not in the diff).** With `CACHE_AUTO_PURGE` on, writes already invalidate scoped entries, so TTL only bites entries that AREN'T purged = **stable-but-expensive reads** (aggregations, low-churn deep reads). Those are where a long per-path TTL relieves Postgres; hot-mutated collections are purge-dominated so TTL is irrelevant there. Framing = "long TTL for expensive-stable, short for volatile."

**Design = first-match rule set**, keyed `path`(prefix) + `method` + `query_shape` (`aggregate`/`item`/`list`), fallback global `CACHE_TTL` on no match → **empty table = current behavior byte-for-byte** (retrocompat). Method dimension near-useless (only GET + /graphql POST reach cache) but kept for completeness.

**3 files shipped:**
- `api/src/cache-ttl-rules.ts` — `resolveCacheTtl(descriptor)` lazy in-mem load, first-match by `sort`; `classifyCacheQueryShape`; `setCacheTtlRules`. Cleared cluster-wide by a **`cacheTtlRulesChanged` bus message** (same live-flip as `schemaChanged`/`cacheStatsToggled`) → edits apply live, hot path never hits DB once warm.
- `20260721A-add-cache-ttl-rules.ts` — `directus_cache_ttl_rules` table (path/method/query_shape/ttl/sort).
- `respond.ts` — resolve TTL once, thread through stored value + `__expires_at` + `__tags` + CDN `Cache-Control` (closes: header previously read global env directly). Removed now-unused `getMilliseconds` import.

**Accepted decisions — SETTLED, do NOT re-raise in a fresh review:**
- **Rules store, NOT the descriptor table.** jean floated "use the cache descriptor table" ([[project_directus_cache_admin_page]] `directus_cache_descriptors` / the Redis `:entry:` sidecar). Rejected: descriptor is per-KEY telemetry created AFTER a fill — wrong lifecycle (policy must be known BEFORE the entry exists → chicken-egg for new paths) and wrong granularity (opaque hash incl. user/ip/query, thousands of rows/endpoint). See [[feedback_view_filter_not_config]].
- **Custom `/utils/cache/ttl-rules` endpoints over `/items`** — `directus_*` tables forbidden via `/items`; matches existing `/utils/cache/*` family (not a registered system collection).
- **Query shape coarse** (aggregate/item/list) — enough to split expensive aggregates from cheap item reads; finer axis open if wanted.
- **Per-entry live override** (extend/shorten ONE existing cached entry from the page) IS a good fit for the descriptor handle — but it's separate firefighting, explicitly out of scope of this policy layer.

**TODO before un-drafting (parked):** `GET`/`POST /utils/cache/ttl-rules` controller endpoints (`setCacheTtlRules` exists); admin Cache page "Apply recommended TTL" action wiring the existing p95 recommendation into a rule; `cache-ttl-rules.test.ts` (classifier decoys, first-match/sort, wildcards, prefix, missing-table fallback, bus reload).

Related: [[project_directus_cache_admin_page]], [[project_directus_cache_namespaces]], [[project_directus_schema_read_cache_tagging]].
