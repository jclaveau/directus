---
name: project_directus_stale_cache_stranded_swept_sets
description: Stale scoped-cache HIT after the registry purge (#576/#578/RNS) — first suspect is a `swept:*` set moved by a pre-C build and named nowhere; what to check and how it gets cleared
metadata:
  type: project
---

**Symptom:** a scoped-cache entry survives a purge that covered its pins, and is served
stale until TTL (48h in prod, see [[project_directus_prod_cache_measurement]]).

**Mechanism (2026-09-29, #570 purge-scaling):**
- C's purge (#576, also in A+C #578 and RNS) moves each index set aside and names it,
  in ONE Lua script: `RENAME fingerprint:… → swept:<coll>:<uuid>:<n>` then
  `SADD swept-index-keys <that name>` (`api/src/scoped-cache/redis-store.ts` ~:377).
- C's recovery reads ONLY `swept-index-keys`. The trunk before C found moved sets by
  `SCAN swept:*` and never named them.
- So a set moved by a **pre-C build** is named nowhere. C's recovery never releases it,
  and its entries stay alive.

**When it can happen (only when two builds run at once):**
1. The rolling overlap of the FIRST deploy that ships C (old nodes still run trunk code).
2. A rollback to a pre-C build, then rolling forward again.
3. A node stuck on an old build after a deploy.

**What does NOT cause it:**
- A new-build crash mid-purge: the RENAME and the SADD are atomic, so the set stays named.
- Redis eviction: prod is `maxmemory 0` + `noeviction`.
- An expiry on `swept-index-keys`: it has none.

**What clears it:**
- The reap port (RNS 4bfdb263fe + c2e10341ad, ported to C/A+C 2026-09-29). The reap
  SCANs `<prefix>*`, SADDs every `swept:*` key into `swept-index-keys`
  (tally `strandedSweptKeys`), then `reapScopedCacheIndex` awaits
  `releaseStrandedScopedCacheSweeps()`.
  - This bounds the stale window by the reap interval, BUT only if the reap is scheduled
    in prod (open decision as of 2026-09-29).
- The build-identity flush ([[project_directus_build_identity_cache_flush]]) drops the
  whole `<ns>:scoped-cache-index:*`. It runs at the new build's boot, so an old node
  purging after that flush can still strand a set.

**Deploy fill pause (#578, e3339e4f33 then the process-list end, 2026-09-29; replaced the legacy-bare mirror):**
- A boot whose core build id (`resolveCoreBuildId`: CACHE_BUILD_ID → baked commit →
  RAILWAY_GIT_COMMIT_SHA → version) differs from `<ns>:scoped-cache-index-build` sets
  `<ns>:scoped-cache-fill-pause` PX `CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX` (renamed from
  `CACHE_SCOPED_DEPLOY_FILL_PAUSE` in 78dd7b18f7) (a CEILING now,
  default 5m, unmeasured; jean wants it measured). Same-build replicas join its PTTL.
- Ends early: one node holds `<ns>:scoped-cache-fill-pause-watch` (15s, renewed each
  5s look), asks the processes bus query (`collectProcessReports([])`), and after 3
  looks in a row where every report's `self.coreBuildId` equals its own AND its own
  report is present, DELs the pause (compare-and-delete on the build). A report with no
  `coreBuildId` = a pre-field build = the build before.
- Measure it from the log line `[scoped-cache] fills resumed N ms into the pause after a
  deploy, <how>` (how = once no process… / ended by its watcher / at its ceiling).
- During it, new-build nodes do not fill, and no marker is written. At its close, a reap
  names the old nodes' sets.
- Stale risks:
  - an old node living past the ceiling (HIGH), or one silent for 3 looks while alive;
  - `PROCESSES_REPORT_ENABLED=false` → always runs to the ceiling (safe side);
  - a rollback to a pre-#578 trunk needs a manual `cache flush` once the #578 nodes are
    gone.
- A fresh or empty namespace also pauses on its first boot: bb/perf set the pause to 0.

**What to check on a stale report:**
1. **Unnamed swept sets:** diff the `SCAN <ns>:scoped-cache-index:swept:*` results
   against `SMEMBERS …:swept-index-keys`. Any key in the scan but not the set is
   stranded. Read-only on prod; never mutate prod Redis without a go.
2. **Deploy timing:** did a deploy, rollback or stuck node overlap the entry's fill
   and its purge?
3. **Reap history:** did the reap run since, and did its tally show
   `strandedSweptKeys > 0`?
4. **Cache audit (#499):** it replays from descriptors, not the index, so a survivor
   shows as verdict `stale` with `purgesSinceFilled > 0`
   ([[project_directus_issue498_cache_audit]]).
   - It needs CACHE_STATS_ENABLED and a descriptor.
   - It finds the entry only if a run reaches it before TTL.
   - It detects the entry; it does not prevent the stale read.

If none of these match, look at the other known stale vectors:
[[project_directus_scoped_cache_tag_derivation]] (enrichment outside the AST),
[[project_directus_scoped_cache_pin_soundness]], and
[[reference_directus_takeover_cache_scoping]].
