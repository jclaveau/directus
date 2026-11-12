---
name: project_directus_raw_trx_purge_pr641
description: PR #641 raw knex trx bypassing queueAfterCommit — fix A+B chosen, trade-offs, and the OPEN cache-events.ts raw-writer purge gap (HIGH, not fixed)
metadata:
  author: Jean Claveau
  type: project
---

`queueAfterCommit`/`queueMergedAfterCommit` (api/src/utils/transaction.ts) now also queue on a raw top-level knex trx (outermost gets own task list, run after commit, dropped on rollback; wraps `rollback`/commit signal because a callback-less trx fires "done" on both). Fix B moved `services/utils.ts` cache-settings write onto `transaction()`. Branch off `v11.10.1-hhh-dev`, not `main` (main = upstream mirror).

**Settled trade-offs:** raw-trx caller does not await the purge (stale window until purge lands, lost if process dies); purge runs on `getDatabase()` since a trx has no link to its opener. Only 1 core caller handed a raw trx to a service; extensions do it freely, hence fix A.

**Open, NOT fixed:** `cache-events.ts:1161` raw `trx(...)` writes `directus_cache_stats_*` (system collections) and never purges; nothing keeps `GET /items/directus_cache_stats_*` out of the response cache → can serve stale (HIGH). #640's "raw writers unaffected" was wrong for `services/utils.ts:770` (writes `directus_settings`). `cache-audit-runs.ts:320` is safe (read via /utils routes, response cache off).

**Why:** jean's fork task from the cache-admin session. **How to apply:** reviewing cache purge/after-commit work → don't re-raise A-vs-B or the trade-offs; the cache-events gap may need its own issue. See [[project_directus_scoped_cache_pin_soundness]].

**Status:** merged into v11.10.1-hhh-dev 2026-10-27 as 0b06d88cb6 (head 0f06504608). The cache-events.ts raw-writer gap is tracked in issue #642 (reach: /graphql/system only; /items 403s directus_*; recommended fix: SYSTEM_DENY_LIST).
