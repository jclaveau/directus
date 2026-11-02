---
name: reference_directus_blackbox_port_slices
description: A bb file spawning its own Directus takes its port from freePortOfWorker (@utils/free-port-of-worker, a per-worker slice), never get-port directly — two workers can draw the same port and one file silently tests the other's instance
metadata:
  author: Jean Claveau
  type: reference
---

`import { freePortOfWorker } from '@utils/free-port-of-worker'` — never `get-port` (lint-enforced in
`eslint.config.js`, block over `tests/blackbox/**/*.ts`).

```
VITEST_POOL_ID=1 -> 21000-21199
VITEST_POOL_ID=2 -> 21200-21399   (200 ports a worker)
no VITEST_POOL_ID -> throws; slice exhausted -> throws (no random fallback)
```

**Why:** get-port checks a port is free, the spawned instance binds it ~2 s later.
Two workers checking inside that window get the same port; the loser's instance
dies on EADDRINUSE and its `awaitDirectusConnection(port)` succeeds against the
WINNER's instance. The file then runs its assertions against another file's env:
missing `x-scoped-cache-tags` header (undefined), HIT after a write that should
have purged. It reads exactly like a stale-cache product bug.

**How to tell:** download the shard's `blackbox-timings-<vendor>-<shard>` artifact
(pick the one matching the job's `run_attempt`), and look for one port in
`timings/boots.jsonl` under two files. Seen on run 41208963382 attempt 2: fk-no-key
and cache-entry-envelope both on 45195, 122 ms apart.
