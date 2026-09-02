---
name: project_directus_purge_recovery_bare_tag
description: Why cache-purge-recovery.test.ts went red after #358 merged its base — the drain ran while the ENTRY store was still offline; the bare-collection-tag theory this file used to carry was refuted
metadata:
  type: project
---

**The bare-tag theory this file used to carry was WRONG. Do not re-adopt it.** I
re-derived it mid-session on 2026-08-24 and had to abandon it again — it is plausible
from reading the code and false in fact.

**Real cause, measured** (shard 7 instance log, two lines 2ms apart):

    15:06:29.976 WARN  [response-cache] store: Error: The client is offline
    15:06:29.978 INFO  [scoped-cache] finished 3 pending purge(s)

The tags and the entries sit behind **two different clients**: ioredis carries the tag
SETs, the response cache is a Keyv over node-redis. Only ioredis's `ready` started the
drain. The Keyv store rejects while offline (`disableOfflineQueue`) and `@keyv/redis`
swallows that into `undefined`, so the drain deleted no entry, reported every purge a
success, and cleared the records — the only thing left pointing at the stale entries.
`read=MISS sibling=MISS` was the offline store missing for free, NOT a bare-tag purge.

**Fixed in #358** (`scopedCacheStoreDropsEntries`): the drain writes an entry and reads
it back before touching the records. `isReady` cannot answer this — node-redis reports
`isOpen:false, isReady:false` both while offline AND before it has ever dialed, and it
dials on its first command, so keying on the flag retired the boot drain entirely
(caught by a blackbox case that boots a second instance and waits on the table without
issuing a request of its own, since any read would dial the store itself).

**Still true from the old note:** `purgeOrRecord` depends on `disableOfflineQueue` — it
records *because* the ioredis command rejects; with the offline queue enabled the purge
would hang and nothing would be recorded. #366 makes #365 work.

Related: [[project_directus_cache_failure_semantics]] (why one half is silent),
[[project_directus_pr366_redis_resilience]], [[feedback_instrument_before_theorising]].
