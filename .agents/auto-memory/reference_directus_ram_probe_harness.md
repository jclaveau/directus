---
name: reference_directus_ram_probe_harness
description: How to measure a Directus worker's RAM locally — throwaway schema replica, gc-on-signal preload, module tracer, load arm
metadata:
  author: Jean Claveau
  type: reference
---

Scratch harness used for the 2026-09-08 RAM study (files under the session scratchpad;
recreate, they are not in the repo).

1. **Database.** A consumer schema replica (see the consumer repo's memories) restored as a
   throwaway `ram_probe` on `blackbox-postgres-1` (port 6100), then `dist/cli/run.js
   bootstrap`. Users must be created with a real TLD — `@example.com`, not `.local`,
   which `UsersService.validateEmail` rejects.
2. **Measurement preload.** `NODE_OPTIONS="--expose-gc --require probe.cjs"`, where
   `probe.cjs` handles `SIGUSR2` by calling `global.gc()` twice then appending
   `process.memoryUsage()` to a log. `v8.writeHeapSnapshot()` also forces a full GC but
   writes ~79 MB and inflates RSS permanently — use it once for composition, not for
   arms.
3. **Module tracer.** `module.registerHooks({resolve, load})` plus a
   `Module.prototype._compile` wrapper records every URL, its source byte length and its
   `parentURL`. That gives both the per-package byte table and the import chain naming
   the file to fix.
   The 10-line version that answered "which api modules does `autoscale` reach"
   (156, 75 under `database/`) — run as `node --import ./trace-loaded.mjs <entry>`:
   ```js
   import { registerHooks } from 'node:module';
   const loaded = [];
   registerHooks({ load(url, ctx, next) { loaded.push(url); return next(url, ctx); } });
   process.on('exit', () => {
     const api = loaded.filter((u) => u.includes('/@directus/api/dist/'))
       .map((u) => u.split('/@directus/api/dist/')[1]);
     console.error('api modules:', api.length, '\n' + api.join('\n'));
   });
   ```
4. **Snapshot analysis.** Aggregate `nodes[]` `self_size` by `node_types[0]` and by
   `(type, name)`; strings over 60 KB are retained module sources and identify the
   package by their first line.
5. **Load arm.** 40 rounds × 25 concurrent authenticated `/fields` + `/collections`.
   Post-load RSS is noisy (±30 MB run to run); idle RSS and heapUsed are the stable
   signals, so decide code changes on heapUsed and flags on the within-code delta.

Gotchas: `pkill -f "dist/cli/run.js start"` kills the Bash tool's own shell
(exit 144) — kill by pid. `cp` of two files both named `auth.js` into one backup
directory silently loses one. Back `dist` up before patching it; the source tree may
carry unresolved conflict markers and cannot be rebuilt.
