---
name: reference_directus_withcache_inflight_dedupe
description: withCache shares a running read per process since #747; before, two concurrent same-key reads both queried and a blackbox statement count over them flaked 3-or-4
metadata:
  author: Jean Claveau
  type: reference
---

`withCache` (`with-cache.ts`) keeps a per-process `runningReads` map (`permissions/running-reads.ts`): a call that finds a read of its key still running waits for it instead of querying (since #747). Every caller gets a `structuredClone` of the result, `clearCache()` empties the map, and a joiner whose shared read failed reads on its own. Peer processes still query on their own.

**Why:** before it, `Promise.all` in `get-permissions-for-share.ts:50` (sender and share in the same role, same `fetchRawPermissions` key) ran 3 or 4 `directus_permissions` selects; #747 shard 8 failed on `- "select": 3` / `+ "select": 4` for request 4 of `role-share-access.feature`. jean ruled "fix in this PR" (option B), not drop the row.

**Traps found in review (#747):** sharing the live result leaked one user's admin flag to another (`_fetchGlobalAccess` mutates the roles' access it gets); a joiner after a clear got the pre-clear read; a joiner failed on the first caller's aborted transaction (`Context.knex` can be a trx). Any new shared-read code needs all three.

**How to apply:** a statement count over two concurrent same-key reads is now stable within one process. A count that still flakes 3-or-4 → look for reads on two processes or two different keys, not withCache. A read running across a `clearCache()` still sets its pre-clear value after the clear (pre-existing); joiners now share that value too. See [[project_directus_issue746_multi_role]].
