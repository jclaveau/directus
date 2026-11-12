---
name: project_directus_refused_build_record_parked
description: PARKED 2026-09-30 — a build record Redis refuses with the link up leaves the scoped-cache fill pause open forever on that node (every read MISS until restart); rare, fix kept on a local branch
metadata:
  type: project
---

CodeRabbit on #574 (thread 4144677903, `api/src/cache-build-identity.ts:274`).
jean parked it on 2026-09-30: "it is rare, just keep the memory if we ever need it one day".

**The defect:**
- `fillsPausedUntil` starts `null`, which means paused.
- `recordScopedCacheBuild` catches a failed record into a `warn` and never calls `pauseScopedCacheFills`.
- So fills stay paused, with no timer and no watcher. Every read on that node is a MISS until a restart.
- The retry exists only on a later `ready`: `purge.ts` fires the record again when `scopedCacheFillPaused()` holds.
- So a refusal with the link DOWN self-heals on reconnect. A refusal with the link UP never does, because no `ready` comes.

**When the link is up and the record still fails:**
- `OOM command not allowed`, which needs `maxmemory` with `noeviction`; prod runs `maxmemory 0`;
- `READONLY` after a failover points the node at a replica;
- a command timeout on a busy Redis;
- `resolveCoreBuildId()` throwing, since it sits inside the same `try`.

**The fix, written and unit-tested, not shipped:**
- Local branch `backup/refused-build-record-fix` in the purge-home-pin worktree (`c79e0eb56d`).
- The red tests are `6a92727c64`, reverted on #574. Their CI run was red as expected: the Unit Tests (api) job of run 36726090650.
- Shape:
  - `pauseScopedCacheFillsUnrecorded(ceilingMs)` holds fills to the `CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX` ceiling with no watcher. The shared key is missing, so a watcher would read the pause as ended after about 5 s.
  - A `buildRecorded` flag, with `scopedCacheBuildRecorded()`, makes `ready` retry while the build is unrecorded: `buildRecordWanted = !scopedCacheBuildRecorded() || scopedCacheFillPaused()`.
- Rejected alternative: fill again at once on failure. A deploy overlap would then fill without the pause, which is the stale-entry risk the pause exists for.

**How to apply:** if a node is seen stuck in MISS after a deploy, with `recording the build for the index failed` in its log, this is the cause. Cherry-pick both commits.

Related: [[project_directus_pr534_purge_scaling_578]].
