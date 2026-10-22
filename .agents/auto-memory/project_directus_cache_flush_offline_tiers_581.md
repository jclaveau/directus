---
name: project_directus_cache_flush_offline_tiers_581
description: PR #581 (MERGED 67d2400309) — `directus cache flush` cleared _system/_lock while KeyvRedis tiers were connecting-not-ready and still exited 0; root cause, fix, accepted trade-offs, valid red proof; do not re-raise
metadata:
  author: Jean Claveau
  type: project
---

**Bug:** `getConfig` dials each KeyvRedis with `void getClient()` and never awaits it;
`getClient()` returns once `isOpen` (connecting, not `isReady`); `disableOfflineQueue`
then refuses the first commands with "The client is offline"; Keyv turns that into an
`error` EVENT and resolves, so `failures=[]` and the CLI exits 0. The FLUSHDB "worked"
because it runs on ioredis, which queues offline. Introduced by 9997d1d7fe, not #572.
Found on planner PR #795's preview deploy; the log also said "dropped 0 scoped-cache
index keys" after a FLUSHDB (the FLUSHDB already took the index).

**Fix (cache.ts):** `awaitStoresReady` (≤5 s, waits `once('ready')` on tiers with
`isReady===false`, warns then flushes anyway), `storeErrorsDuring` (error listener around
each tier op → failure → CLI exit 1), skip the index drop after a FLUSHDB in
`flushCaches`/`clearCacheTargets`/`flushResponseCache`, log "FLUSHDB on redis db N[, the
scoped-cache index with it]" (index clause only in scoped mode). `clearCacheTargets` (the
`/utils/cache/clear` route) now throws 503 `ServiceUnavailableError` when a tier refused.

**Accepted, documented in docstrings/PR (do NOT re-raise):** a flush during a Redis outage
waits 5 s more (also apply-diff/migrations); a concurrent request's refused command on a
shared tier counts against the clear; cluster clients have no `isReady` and are not waited
for; boot flush (`flushCachesIfBuildChanged`) is not exposed — tiers are connected long
before, only the CLI builds and clears in the same tick.

**Proof:** unit 7→9 tests red with the fix reverted; blackbox scenarios added to
`cache-redis-db-flush.feature` (FLUSHDB db 7 path + shared-DB Keyv `clear()` path, the one
that was actually refused) — red proof run 36570778215 shard 3, both fail on "the system
cache no longer holds that entry" (expected 0, got 1). The FIRST red proof was invalid
(step-order load failure, see [[feedback_regression_test_must_fail_without_fix]]). Shard 1
`eps_mid.leaves` and `autoscale-churn`/`graphql-ip-gated-read` reds are known flakes
([[project_directus_blackbox_flakes]]). CodeRabbit's "FLUSHDB still scans" thread was
against the deliberate revert head and was withdrawn.

Related: [[project_directus_cache_redis_db_559]], [[project_directus_blackbox_cucumber_step_order]].
