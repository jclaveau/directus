---
name: project_directus_pr607_accepted_exceptions
description: PR #607 (mutation filters run in the transaction, context.transaction) — settled rulings from the deep reviews, what is deferred to #610, and the traps hit; do not re-raise
metadata:
  author: Jean Claveau
  type: project
---

PR #607 (`v11.10.1-feat/mutation-hooks-in-transaction`): create/update/delete filters run inside the mutation's transaction; `context.transaction: Knex` added, `context.database` kept as the same object, `@deprecated`.

**Settled (do NOT re-raise):**
- **M1** no savepoint around the filter emit: a hook that swallows its own DB error leaves PG aborted (25P02 → 500). Loud failure beats silent loss of hook writes; matches create. Risks line in PR body. Same for the service's own hook-added snapshot read ("stick to the transaction for consistency").
- **H4/M2** stay in the transaction: a rolled-back refusal purge / flow log describes nothing that happened. Wording + Risks lines only, no `getDatabase()` second connection.
- **L1** writes outside the transaction go through the extension context's `database` — intended way. One bb hook keeps that as witness (`cache-update-takeover.feature:45`).
- **L2** typing narrowed: `items.<op>` | `${string}.items.<op>` | `${SystemScope}.<op>`; `SystemScope` from `SYSTEM_COLLECTION_NAMES` (`@directus/constants`, 36 names); `MutationAction = Exclude<PermissionsAction,'read'|'share'>`. Parity test stays in `api/src/system-collection-names.test.ts` (system-data has no vitest; reads its dist, rebuild locally after a YAML edit). `fields.*` stays in `BareFilterEvent` (FieldsService emits by hand); `auth.*` dropped. `ItemsDeleteEvent` payload defaults `PrimaryKey[] | null`.
- Type is `Knex` not `Knex.Transaction` (no commit/rollback for hooks). Reads NOT moved into a transaction (cost on hottest path, READ COMMITTED gives no snapshot anyway).
- `deleteMany` builds hook declarations ONCE on purpose (delete reads no `skipPurgeFor`; per-attempt reset drops attempt 1's `purgeBy` → stale). Comment in code; surviving mutant `del_declarations_per_attempt` is known, retry test = #610 point 5.
- Non-PG points (H1 update reset drops purgeBy, H4 create/upsert skipPurgeFor leak, takeover-on-failed-attempt gap, sqlite pool deadlock) → #610 points 1-5 + `TODO(#610)` ([[feedback_directus_non_pg_review_points_to_610]]).
- Planner follow-ups (switch 5 takeover hooks of #805 to `context.transaction`, check custom-event filters, out-of-band writes via extension `database`) live as PR comment #607 issuecomment-6191712019, done AFTER merge.

**Final review (d91d231024) → jean ruled "fix them all in a loop with regression tests, prefer bb over unit, then merge":**
- **H1 (PG, real, pre-existing):** a nested mutation's failure purge is queued on the CALLER's transaction (`queueMergedAfterCommit`), so when the parent rolls back it is dropped, while a hook that wrote through the pool already committed → stale HIT. Fix: in the catch on a caller transaction also purge takeovers at once through a pool-bound scoped cache (`this.fork({ knex: getDatabase() })`), keep the queued coarse purge (double purge safe). bb: parent PATCH with nested O2M `create: [{take-over}, {id: dup}]`, cached read of X must MISS. PR-body sentence "That is correct: the hook wrote through that same transaction" was wrong → corrected.
- Item 2: createMany catch with only `purgeBy` (no changedKeys) → `purgeDeclaredScopedCache`, not bare-fingerprint purge. Item 3 (coarse purge though nothing inserted) left as is — mirrors upsertMany, over-purge only. Item 4: createMany purges only the LAST attempt's takeovers (`attemptTakenOverKeys`) → added to #610 point 1 + `TODO(#610)`. Item 5: inline `takeoverUndeclared`. Item 6: `.feature` line says "refused with the status 400 and the message:".
- Order: tests-only commit pushed alone first; its shard must fail on the cache check (HIT where MISS expected), not on a message.
- Auto-mode classifier REFUSES `gh pr merge` even with an explicit ask → CI green, then hand jean the exact merge command to run.

**Traps hit:**
- knex-mock-client files a query under the matched handler's method: with only `on.any('test')`, `history.update`/`history.delete` stay `[]` → "no write" assertions vacuous. Register `on.update`/`on.delete`.
- Red bb commit can be invalid: first red push failed on two guessed error messages (dev env returns the hook's own `Error` as is; PG PK unique violation names no value) before reaching the cache step. Check the red failed at the intended step.
- Mutation-test the new tests (29 breaks: 14 survived before, 28/29 after) — each "same transaction" guarantee needs a test asserting the hook query and the write share one `history.transactions[n]`.
- Shared node_modules resolves `@directus/types` from other worktrees: typecheck with untracked `tsconfig.paths607.json` overrides; `pnpm exec eslint` in the worktree tries to reinstall → use a pnpm shim.
- A fix agent can hit its 200-turn limit mid-task (SendMessage to resume) and may refuse a requested fix after its own probe proves it makes cache stale — relay, don't force.

**Why:** reviews are always run in a clean session; without this they re-flag the same points.

- MERGED 2026-10-15 15:21 UTC as `2af3fae4d0` (`--merge`, jean ran `! gh pr merge 607 --repo jclaveau/directus --merge` himself). Planner session `cache-admin-7f` (misleading name: it does the planner #805 work) was messaged to switch the 5 takeover hooks to `context.transaction` once its lockfile pins a `-dist` carrying the merge. Adding `Bash(gh pr merge:*)` to `.claude/settings.json` allow is untested against the auto-mode classifier (it runs apart from allow rules).
- Final head `3b3412a4a0` (CI green). Red proof for item 2 = temp revert commit `b792bbd32f` (shard 4 MISS-vs-HIT), fix restored in `3b3412a4a0` with no force-push.
- Inert-create bb scenario must declare a FOREIGN collection (`test_takeover_create_foreign`): a declared slice in the create's OWN collection drops that collection's global reads by design, so it stays MISS even with the fix (vacuous).
- #610 point added: `createMany` catch purges only the failed attempt's takeovers, each retry overwrites the list → row taken over on attempt 1 but not the retry is never purged if retry fails (stale). Fix line: "on both paths". Do not fix in #607.
