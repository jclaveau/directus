---
name: project_directus_pr634_update_groups_batch
description: PR #634 (Fixes #629) updateGroups writes same-column runs in one knex.batchUpdate json statement on postgres — settled fallback rule (23505 only), error-translation choice, bb scenarios, worktree gate workaround
metadata:
  author: Jean Claveau
  type: project
---

PR [#634](https://github.com/jclaveau/directus/pull/634), branch `v11.10.1-perf/update-groups-batch-update`, into `v11.10.1-hhh-dev`. `applyUpdateGroups` splits groups into **runs** (consecutive, same scalar column set, no repeated key) → one `knex.batchUpdate(..., { mode: 'json' })` per run on pg (`update … from jsonb_populate_recordset(null::"t", $1)`); a run of one group, nested/json/geometry/alias fields, pre-mutation errors and non-PG (`TODO(#610)`) keep `applyUpdateGroup`. Dates go as local time + offset (`format(..., "yyyy-MM-dd'T'HH:mm:ss.SSSxxx")`) so `timestamp` keeps its wall clock. `chunkSize` stays 1000; jsonb cap ≈256MB only reachable by internal callers (byte-based chunking parked until seen).

**Settled (jean picked "C"):**
- Batch error `23505` → rollback to savepoint → per-group `applyUpdateGroup` (a statement picks its own row order, so a swap/shift that works sequentially can hit a transient unique violation; a real violation re-raises the per-group translated error).
- Any other batch error → `translateDatabaseError` thrown, NO per-group replay. Payload passed is `{}` (row unknown) so the message omits the value (`22001` loses the value text) — my call, jean did not object; the alternative (value errors `22001/22003` also via per-group) is open.
- Sparse "different column sets in one statement" knex mode: NOT now; count runs per updateBatch first.

**bb coverage** (`update-groups.feature`, slot collection got an `owner` M2O; `label` nullable, default 'unlabelled'): fallback hand-over (probed in a throwaway pg17: seq scan updates the earlier-stored row first), real unique violation → 400 nothing written, FK `23503` (`owner: 999999`; scalar M2O id passes `batchColumnsOf`) → `Invalid foreign key "999999" for field "owner" … (references "test_update_groups_owner")`, mixed-field groups. NOT-NULL is unreachable in bb: Directus validates `is_nullable:false` app-side first. TZ and json/geometry stay unit-only (bb server runs UTC).

**Review of 5507ba7122** (/pr-autoreview; CodeRabbit skipped: "manual review required"). Fixed in `167dbab3cd` (tests red first on `7e96ce876d`):
- 🔴 preset keys (`presetUpdatePayload`) were added AFTER `batchColumnsOf` gated `group.data` → each group's `payloadWithPresets` now goes through `batchColumnsOf` too.
- 🟡 numbers go as `String(n)` like node-pg (jsonb rendered `1e-7` as `0.0000001`); fields set to `undefined` are left out (the batch wrote NULL).

**Accepted exceptions (jean ruled 2026-10-25, do not re-raise):**
- #5 → A: the batch can succeed where groups written in order raise 23505 (`[{id:2,code:'A'},{id:1,code:'Z'}]` with row 1 holding 'A'). The end state is valid; no pre-check.
- #6 → "expected": one `activity.create` / `revisions.create` / `readMany` per run carrying N rows, instead of one per group. That is the point of #629.

**Gotchas:**
- Every bb scenario shares the slot collection's composite unique `(holder, slot)`: new scenarios need their own holder names (`holder-d`, `holder-e`) or CreateItem is refused.
- Raising batch errors (no swallow) broke every unit test whose MockClient has no pg dialect: mock `getDatabaseClient` → `'sqlite'` in try/finally (items, scoped-cache-purge, roles tests; 2 failed, then 7 on the next head). Grep other suites reaching `updateBatch` before pushing.
- bb `--log-failed` is empty; use the run-logs ZIP.
- Worktree with symlinked `node_modules`: `pnpm exec` tries an install and fails; run the style gate by hand: `./node_modules/.bin/eslint --no-config-lookup --config eslint.style.config.js --format json <files>` then keep errors on added lines of `git diff --unified=0 origin/v11.10.1-hhh-dev`. See [[project_directus_worktree_shared_node_modules]].
- knex-mock-client `dialect:'pg'` recursion: [[reference_directus_mockclient_pg_dialect_events]].
- Blackbox pg shard 5 `autoscale-prewarm-load` `[…,6,4,2,1]` vs `[…,6,3,2,1]` on 167dbab3cd: the known pm2 worker-count flake, untouched by the PR.
- Blackbox pg shard 4 `expected 'MISS' to be 'HIT'` (cache-composite-tag-view, cache-content-version) was a flake: gone on the rerun, files only do single-item PATCH. See [[project_directus_blackbox_flakes]].
- **MERGED 2026-10-25** as `72edae70cc` (`--match-head-commit 167dbab3cd`, after the shard 5 rerun went green; jean said "merge once shard 5 is green"). Follow-up: [[project_directus_issue636_batch_to_db_layer]].

**Why:** #629 set-based UPDATE; **How to apply:** when reviewing or extending the batch path, don't re-raise the fallback-on-23505 rule or the `{}` payload; related [[project_directus_knex_fork_switch]], [[project_directus_pr387_update_groups]].
