---
name: project_directus_predating_review_points
description: Branch v11.10.1-fix/predating-review-points — the 12 pre-existing #614 autoreview findings, which 9 jean cleared for a no-design-choice fix loop, which 3 wait on him, and the loop's method
metadata:
  author: Jean Claveau
  type: project
---

Branch `v11.10.1-fix/predating-review-points`, worktree `.herdr/worktrees/directus-cms-2/predating-review-points`, STACKED on #614's head (B2 touches files.ts, which #614 rewrote; basing on hhh-dev would conflict). Nothing pushed, no PR yet at handoff (2026-10-18). Own PR off the stack, not into #614 (split by intent: all predate it).

**Loop (jean: "fix all those not requiring a design choice in a loop with regression tests, bb gherkin preferred")**: one subagent per finding, sequential in the one worktree (shared node_modules), TWO commits each: `test(...)` first, then `fix(...)`; unit red-without/green-with proven locally; gherkin only where reachable over HTTP (CI-only, a tests-only CI run can show them red); I verify each agent's commits before launching the next. Order: D3 → D8 → D7 → D9 → D2 → A6 → Comments → D10 → B2 (B2 last: uploads OOS, jean may drop it).

Done: D3 `9cdf8e2869`/`c683dc8d71` (updateOne merges partial `schema` with stored FK actions; frozen-schema test now expects `on update NO ACTION`). D8 `94c834e1cd`/`0988bdf543` (`readOne(args.collection, args.field)`). D7 `4701ecd21b`/`bec92b6fe7` (real bug = `fields` added to shared input type BEFORE the copy, so update_collections_item accepted-and-ignored it; now 400 GRAPHQL_VALIDATION — client-visible, create untouched). D9 `716e0861fa`/`74d1c05a95` (sync alterTable cb in fields.ts:559; no bb scenario: not HTTP-observable; sweep found no other async cb; `PATCH default_value:"CURRENT_TIMESTAMP()"` TypeError 500 is a separate unfiled defect).
All 9 done + pushed 2026-10-18, head 2a377b0961 (gates green: eslint, style, tsc, vitest --changed 3783/3783). PR #625 (base #614 branch) opened 2026-10-22 on jean "1"; red-proof draft PR #626 (branch v11.10.1-test/predating-red-proof = test commits only, worktree predating-red-proof) — close + delete branch once read. D10 added @vitest/coverage-v8 devDep to themes (needs jean ok). bb scenarios (D3, D8, D7, Comments, B2-tus) not yet seen red/green in CI.

**jean's rulings 2026-10-22**: C2 → B (children keep `autoPurgeCache:false`, signal `onResponseCacheFlushDeferred` up; upsertMany flushes once after commit) = `de9318fc39`/`547aafc997` + bb `users/cache-role-move-flush.feature`. D4 → A (retry after failed load) = `6699f18b52`/`f01f35d1f2`; B (keep last loaded set) filed #627, comment in manager.ts points to it. Pushed to #625 at 547aafc997, body updated.

B6 → 400 (jean, no flag) = `fe7cf1887a`/`b33f3f64ae`: new upload with client `id` X and no filename_disk refuses when `X<ext>` is held by another row or the disk (existing diskNameTakenReason); row whose id IS X exempt (left to the duplicate-id insert; untested). D10 → keep devDep (jean). Pushed 2026-10-22, head b33f3f64ae.

Then: codecov/patch 93.33% → b64c347535 (tests for derived disk name from type / bare, flush-with-no-cache; relations ternary folded to `&&`) → 100%. C2 opted-out test strengthened (spy on onResponseCacheFlushDeferred, red without fix) 94bee3243b; upsertMany opts typed `MutationOptions & ResponseCacheFlushDeferral` after CI TS2353 in the test 2f4cc08df7. #626 closed, branch + worktree deleted (2026-10-24). Nothing waits on jean; #625 awaits jean's review (never merge).

**Why:** subagent reports are model output; verify the diff + trailers. **How to apply:** don't re-ask which findings need a choice; C2/D4 are ruled.

CR1 (CodeRabbit, 2026-10-24): clear/flush helpers ran at once in a transaction `transaction()` did not open (extension `database.transaction()`); jean ruled fix in #625 with bb test. `runOnceSettled` walks `parentTransaction` to the outermost trx, queues if tracked, else `executionPromise.then(run, run)` logging failures. Test 8b1dd577bb (bb `cache-untracked-transaction-flush.feature` + extension `untracked-trx-write`), fix 267fe8118a. Red-proof compare PR #630 (do not merge; close once red seen).

## 2026-10-24 merged

#625 merged into #614 branch as 2a79312690. Extension-transaction cache clear follow-up: #633 (patch `.transaction` on the getDatabase() instance, default on, no retry, no opt-in). jean ruled it is the extension developer's job, made impossible to get wrong.

## 2026-10-24 jean: "address 627 and 633 in 614"

- **#627 premise is wrong**: `load()` does NOT throw on a broken extension; each `register*Extension` catches its own error and only warns. So "keep last loaded set when a reload fails" has no reachable trigger from a broken extension (D4-A's retry covers only exotic throws like `generateExtensionBundle`). Surface this to jean before building #627.
- **#633 built in #614** (not a new PR): `trackTransactionsOf` patches `.transaction` on the knex instance in `constructDatabase` (utils/transaction.ts), reuses `commitAttempt` (opens via the untracked original method, no recursion); no retry, no opt-in flag. Unit tests in `transaction.test.ts`: 6 go red with the tracker stubbed; the 4 design pins (no retry, no double queue, result returned, `transaction()` still retries) each go red under their own mutation (checked 2026-10-30).
- Why jean chose it: a not-awaited post-commit clear is a ~1-round-trip stale window plus lost-on-process-death; they wanted the mistake impossible rather than documented via `scopedCache.transaction`.

## 2026-10-30 second /pr-autoreview 614 + hhh-dev sync (head f8576d7574, fixes pushed after)

- Fixed in #614: upsertMany flush failure after commit logged (e61a4d7267), file delete past a vanished thumbnail (79c4c8568a), permissions/shares cache cleared after commit via `clearPermissionsCacheAfterCommit` (edbdfa1fe5), cascade-delete bb awaits spawned server (d2b930980b). Finding 9 (spawning bb files in the parallel middle) DROPPED: `sequential-tests.ts:40-50` moves a file to `after` only on race evidence.
- Rulings: user-delete unlink fires no `*.read` hooks (A: no-events option on `getKeysByQuery`); 7 = A (blank Then response cell throws, Given keeps "send only"; scan found 0 blank of 816 asserting rows); 5 goes to #635 as point 6 (storage-scoped unique index), not fixed in #614; 11 (job-queue stops after a throwing job) is Flows, so oos issue #651; storage/upload findings 11-15 go to #635.
- 4 = A (dcdbacf466): create skips a `password: null` like update does; no-password users are normal (invite, SSO first login, admin create), `/users/register` alone requires one. 3 = A (419bf0be62): no 400 (validate-query is schema-free, `_null` on NOT NULL is valid SQL with an empty answer); id-less app-minimal rows never match an id filter, docblock in `with-app-minimal-permissions.ts`.
- Sync merge f5cef058d1 (hhh-dev into #614): kept #614 preset-before-guard order and dropped hhh-dev's second preset step (`presetUpdatePayload` deleted); both transaction mechanisms kept (`findQueuedTasks` first); hhh-dev seeds calling strict `DeleteCollection` must become `DeleteCollectionIfPresent` (items-written-hooks seed broke shard 3, f8576d7574). Shard 1 `cache-last-page-purge` MISS vs HIT after that = suspected flake, rerun.

**Why:** a fresh review must not reopen these. **How to apply:** when merging hhh-dev into #614, grep new seeds for strict delete helpers.

## 2026-10-30 third /pr-autoreview 614 (head a483ea2758)

- Fixed: comments no-user guard moved from updateOne/deleteOne to updateGroups/deleteMany (c846014ae3; flows use the generic ItemsService, so null-user callers are unaffected); an untracked trx whose COMMIT fails drains the rollback tasks (2b94e3c587: knex resolves `commit()` over a failed COMMIT and rejects only `executionPromise`; knex-mock-client's tracker swallows `COMMIT;`, so spy `MockClient.prototype._query`); harness `rememberedText` at the hash retake + SSO refresh token, warm-up status asserted (a483ea2758).
- Rulings 2026-11-01: share PATCH with a null target half → shares are oos, filed #657 ("oos feature: shares: gathered points"); batch CREATE naming one o2m child for two rows stays last-wins (matches the DBMS; a unique index raises the error when one is wanted), no edit. Update path then ruled option A (3c8a95b05a): last-wins by default on BOTH create and update; MutationOptions `refuseChildJoiningSeveralRows: true` brings the 400 back on updateGroups + createMany (created rows named by position); REST never sets it; bb scenarios expect the child on the last key/last batch row, query form dropped (DB row order unspecified).
- Dropped: probe-message purge, stopSpawnedInstance order, IdP listen error, DeleteFieldIfPresent bare 403.

## 2026-11-01 MERGED

#614 merged into `v11.10.1-hhh-dev` as 90dff46c8e (merge commit, head 4b00d4298d). Coverage vs base ddcc750441: overall 50.96% vs 54.07%, api 66.78% vs 71.46%, blackbox 59.82% vs 66.31%. CodeRabbit never reviewed it (458 files, over its 100-file cap).
