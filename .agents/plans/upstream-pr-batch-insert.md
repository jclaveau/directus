# Plan — Upstream PR: `INSERT` → `batchInsert` for `ItemsService.createMany`

## Context

- Fork: `feature/extensions_constants_issue` at `aaa1ad0d5b`. CI green (mssql aside — pre-existing slow tests).
- Upstream: `directus/directus` `main` at `d6e706e647` (no `dev` branch — only `main`).
- Destination branch: `feature/batch-insert-upstream` (already exists locally at `upstream/main`, no commits yet).
- **Histories are disconnected** (`git merge-base upstream/main HEAD` → "no common ancestor"). Cherry-pick is **not
  viable**. The PR must be hand-ported.

## What the PR delivers (Bucket A)

Replace upstream's per-row `createOne` insert with a vendor-bucketed dispatch in `createMany`:

- Vendors that contractually preserve `INSERT … RETURNING` row order → single
  `knex.batchInsert(table, rows, chunkSize).returning(pk)`.
- Vendors that don't → per-row `trx.insert(row).into(...).returning(pk)` loop (same path upstream uses today).
- Collapse `createOne` to a thin `createMany([data]).then(([pk]) => pk)` wrapper.
- Introduce capability `preservesInsertOrderInReturning(): Promise<boolean>` on `CapabilitiesHelper`.
- New env vars: `DB_BATCH_INSERT_CHUNK_SIZE` (knex passthrough, default 1000), `DB_MSSQL_TRUST_BATCH_RETURNING` (opt-in
  for MSSQL).

That's it. No filter-event changes, no error-model changes, no skipable-creation, no async-emitAction churn.

## Commit classification (fork → upstream PR)

`IN` = port into Bucket A. `OUT` = exclude. `SPLIT` = port the batch-insert slice only.

| SHA          | Subject                                                                  | Bucket            | Notes                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1d7d86c048` | feat(items): support of batchInsert()                                    | IN                | Initial introduction.                                                                                                                                                                                                                                     |
| `1ebf833129` | fix: data instead of itemsValus during translateDatabaseError            | IN                | Typo fix, drop the rename.                                                                                                                                                                                                                                |
| `438dffd0e6` | feat(items): batched insert many filterable by create event              | SPLIT             | Keep the `createManyAtOnce` introduction; **drop the `items.db.insert*` filter calls** — those belong to Bucket B.                                                                                                                                        |
| `47833fd312` | perf(items): createMany batched                                          | IN                |                                                                                                                                                                                                                                                           |
| `7a3f613503` | feat(items): fix action-verify-create test                               | IN                |                                                                                                                                                                                                                                                           |
| `7311d5cc4d` | perf(items): store activity and revision row with createMany             | IN                | Batches activity + revisions; upstream's per-row `activityService.createOne` becomes `createMany`.                                                                                                                                                        |
| `2dd0d1255b` | ci(mysql): fix createMany for MySQL, MariaDB and Sqlite                  | OUT               | Built the fallback bucket; later deleted by `8e936467f2`. Final-state-equivalent already in `8e936467f2`.                                                                                                                                                 |
| `76adb1ca48` | perf: explain why MariaDB / Mssql do not support returning               | IN (comment-only) | Drop the obsolete fallback comments; keep the per-dialect rationale (lives in `dialects/mssql.ts`).                                                                                                                                                       |
| `aa999c51de` | perf: support batchInsert for Sqlite >= 3.35                             | IN                | Moves into `dialects/sqlite.ts` (per-version probe).                                                                                                                                                                                                      |
| `32d1a39ce0` | refacto: returning ids support in the database helpers                   | IN                | Adds `preservesInsertOrderInReturning` capability + per-dialect overrides.                                                                                                                                                                                |
| `d178f4387e` | refacto: move IsPrimaryKey type guard to utils                           | **OUT**           | The guards only exist because of the skipable-creation `string\|number` short-circuit (Bucket D). Without Bucket D, `ItemValues` is no longer a union, and the guards are dead. **`api/src/utils/is-primary-key.ts` does NOT belong in the upstream PR.** |
| `8e936467f2` | refacto: use batch insertMany for every insert #6                        | IN                | The big rewrite. Deletes the fallback maze + `api/src/request/request-tracker.ts`. Verify `request-tracker.ts` exists on upstream before deleting (it doesn't — it's fork-only, leave alone).                                                             |
| `f277d4f879` | style: format                                                            | IN (format only)  | Apply prettier as the last step, not as a separate commit.                                                                                                                                                                                                |
| `14b44844f1` | refacto(items): review cleanups + batch-insert edge case tests           | IN                |                                                                                                                                                                                                                                                           |
| `d932cbb1df` | style: format                                                            | IN (format only)  |                                                                                                                                                                                                                                                           |
| `cf5e2d8a4c` | test: pin MSSQL identity-insert limitation in homogeneous-explicit block | IN                |                                                                                                                                                                                                                                                           |
| `547e37d1f9` | test: extend mixed-batch (explicit + auto) test to integer PKs           | IN                |                                                                                                                                                                                                                                                           |
| `4bb9592c3d` | test: deep-equal sorted arrays instead of per-field byName loops         | IN                |                                                                                                                                                                                                                                                           |
| `ce1fa86f40` | fix(ci): unblock cockroachdb image + drop nested ternary                 | SPLIT             | Test fix IN; docker-compose change OUT (CI infra, fork-only).                                                                                                                                                                                             |
| `0b27449465` | feat(items): default-order reads by primary key (env-toggleable)         | **OUT**           | Separate feature — `readByQuery` change unrelated to insert. Track for a follow-up PR.                                                                                                                                                                    |
| `295153a9bf` | refacto(items): restrict default PK sort to integer / bigInteger PKs     | OUT               | Same feature as above.                                                                                                                                                                                                                                    |
| `56ab8ea527` | test: actively verify DB_DEFAULT_ORDER_READS_BY_PK                       | OUT               | Same.                                                                                                                                                                                                                                                     |
| `f985e17863` | fix(items): emitFilter result is non-extensible                          | OUT               | Fix is for `readByQuery` (line 721, after the items.read filter), not insert.                                                                                                                                                                             |
| `62cba42b54` | fix(items): skip default PK sort when query has group/aggregate          | OUT               | Same.                                                                                                                                                                                                                                                     |
| `712bae95e2` | test(mssql): cover both loop and trust-batch paths via env-inject        | IN                | Adds `extensions/env-inject/`. Keep — exercises `DB_MSSQL_TRUST_BATCH_RETURNING`.                                                                                                                                                                         |
| `ecb051b5bd` | fix(lint): extract explicit-id mapping                                   | IN                | Cleanup.                                                                                                                                                                                                                                                  |
| `df46b9c134` | fix(blackbox): cockroachdb in-mem store + mssql UUID case                | SPLIT             | mssql UUID assertion fix IN; cockroachdb docker tweak OUT.                                                                                                                                                                                                |
| `8bb330c72f` | test(mssql): scope DB_MSSQL_TRUST_BATCH_RETURNING toggle                 | IN                |                                                                                                                                                                                                                                                           |
| `44c8a01897` | test: batchInsert with createMany                                        | IN                | Adds `extensions/query-counter/` + the main `batch-insert.test.ts`.                                                                                                                                                                                       |

### Excluded buckets (separate PRs later)

| Bucket                                             | Driving commits                                       | Coupling site in items.ts                                                                                                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B** — `items.db.insert*` filter events (PR #32)  | `415ea65521` + filter calls added inside `438dffd0e6` | Lines 379–391 (`db.insert`), 407–419 (`db.inserted`).                                                                                                                                                                            |
| **C** — filterable db errors (PR #34)              | `ee343a26a2`                                          | Line 442 (`throwDatabaseError`).                                                                                                                                                                                                 |
| **D** — skipable item creation via filter (PR #23) | `4c07cca6f7` + `0a93627178`                           | Lines 225–228 (`if (payloadAfterHooks === null) continue`), 230–237 (`typeof === 'string'\|'number'` short-circuit), 627 (filter), 673–679 (`isPrimaryKey` final map), plus the entire `ItemValues = PrimaryKey \| {...}` union. |
| **E** — optionally async `emitAction`              | `1ddb16ee04`                                          | `await emitter.emitAction(...)` sites — upstream calls them sync.                                                                                                                                                                |
| **F** — `where` vs `whereIn` (lock perf)           | `896fe04840`                                          | Outside createOne/createMany.                                                                                                                                                                                                    |
| **G** — skippable update                           | `776d93cc7b`                                          | `updateOne` / `updateMany`.                                                                                                                                                                                                      |
| **H** — skip read events on update                 | `7f338f5deb`                                          | `updateOne` / `updateMany`.                                                                                                                                                                                                      |
| **I** — error tracking for Railway sleep           | `d6f9f15fcf`                                          | Outside items.ts.                                                                                                                                                                                                                |

## Coupling points to remove from fork `createMany` body

Reference: current fork `api/src/services/items.ts` lines 142–680. For the upstream PR these must NOT carry over:

| Fork lines                                            | What it does                                                      | Decoupling action                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19, 442, 1052                                         | `import { throwDatabaseError }` + use                             | Replace with upstream's `import { translateDatabaseError } from '../database/errors/translate.js'` and the upstream `catch` block (lines 148–160 of upstream): translate, special-case `RecordNotUnique` w/ `pkField.field`, `throw dbError`. |
| 30                                                    | `import { isNotPrimaryKey, isPrimaryKey }`                        | Delete.                                                                                                                                                                                                                                       |
| 166–186                                               | `type ItemValues = PrimaryKey \| { … }` union                     | Collapse to just the object type (the union variant exists only for skipable-creation). Drop the `PrimaryKey` arm.                                                                                                                            |
| 225–228                                               | `if (payloadAfterHooks === null) continue;`                       | Delete (no skipable).                                                                                                                                                                                                                         |
| 230–237                                               | `typeof payloadAfterHooks === 'string' \| 'number'` short-circuit | Delete (no skipable).                                                                                                                                                                                                                         |
| 326                                                   | `preparedItems.filter(isNotPrimaryKey)`                           | Delete the `.filter(isNotPrimaryKey)` — `preparedItems` is already pure objects.                                                                                                                                                              |
| 379–391                                               | `emitter.emitFilter('items.db.insert', …)`                        | Delete the whole block. The batchInsert path becomes: `const insertedRows = await trx.batchInsert(...).returning(primaryKeyField)`.                                                                                                           |
| 407–419                                               | `emitter.emitFilter('items.db.inserted', …)`                      | Delete. Iterate `insertedRows` directly in the `forEach` that follows.                                                                                                                                                                        |
| 442                                                   | `await throwDatabaseError(err, data)`                             | Replace with upstream's `translateDatabaseError(err, data)` + `RecordNotUnique` handling shown above.                                                                                                                                         |
| 542                                                   | `.filter(isNotPrimaryKey)` on `preparedForPostInsert`             | Drop the filter — pure objects.                                                                                                                                                                                                               |
| 627                                                   | `for (const itemValues of itemsValues.filter(isNotPrimaryKey))`   | Drop the filter.                                                                                                                                                                                                                              |
| 673–679                                               | `itemsValues.map(... isPrimaryKey ? ... : itemValues.primaryKey)` | Simplify to `itemsValues.map((iv) => iv.primaryKey)`.                                                                                                                                                                                         |
| any `await emitter.emitAction(...)` in lines 655, 664 | Async-awaited per Bucket E                                        | Match upstream: drop the `await` — upstream emits sync.                                                                                                                                                                                       |

## Features missing from fork's items.ts that **must** be preserved in the port

Upstream's `createOne` has functionality the fork has lost. The upstream PR must keep these intact:

1. **MSSQL trigger-modifications option** (upstream lines 128–133):
   ```ts
   if (getDatabaseClient(trx) === 'mssql') {
   	returningOptions = { includeTriggerModifications: true };
   }
   ```
   For the per-row loop path, retain this. For `batchInsert`, check whether knex's `batchInsert` accepts a similar
   passthrough; if not, document the loss and decide with maintainers.
2. **`opts.overwriteDefaults`** — passed to `PayloadService` constructor; used by Insights/Flows. Fork dropped it; add
   back.
3. **`opts.skipTracking`** — gates the activity/revisions block. Fork doesn't honor it; add back.
4. **`opts.onItemCreate`** callback after PK is known. Fork doesn't honor it; add back.
5. **Fallback `trx.max(pk).first()`** when RETURNING returned no PK (MySQL/SQLite old versions, upstream lines 165–173).
   For the per-row loop path, retain. For `batchInsert` (only used when `preservesInsertOrderInReturning()===true`),
   this fallback isn't needed.
6. **`getRelationsForCollection` + `omit(payloadWithPresets, relationalFields)` for revision delta** (upstream lines
   233–235). Fork's batched path uses `payloadService.prepareDelta(payloadAfterHooks)` directly — verify the semantic
   difference and decide.
7. **`transaction(this.knex, ...)` helper** (upstream's retry/nesting-safe wrapper). Fork uses
   `this.knex.transaction(...)` directly. Use upstream's helper.

## File manifest for the upstream PR

```
api/src/services/items.ts                                              # edited
api/src/database/helpers/capabilities/types.ts                         # edited — add preservesInsertOrderInReturning
api/src/database/helpers/capabilities/dialects/postgres.ts             # edited — add override
api/src/database/helpers/capabilities/dialects/oracle.ts               # NEW — extends CapabilitiesHelperDefault, overrides preservesInsertOrderInReturning
api/src/database/helpers/capabilities/dialects/sqlite.ts               # NEW — version probe ≥3.35
api/src/database/helpers/capabilities/dialects/mssql.ts                # NEW — opt-in via DB_MSSQL_TRUST_BATCH_RETURNING
api/src/database/helpers/capabilities/index.ts                         # edited — re-route mssql/oracle/sqlite from Default to new classes

tests/blackbox/tests/db/routes/items/batch-insert.test.ts              # NEW
tests/blackbox/extensions/query-counter/index.mjs                      # NEW
tests/blackbox/extensions/query-counter/package.json                   # NEW
tests/blackbox/extensions/env-inject/index.mjs                         # NEW
tests/blackbox/extensions/env-inject/package.json                      # NEW

docs/self-hosted/config-options.md                                     # edited (if upstream maintains env-var docs there) — add DB_BATCH_INSERT_CHUNK_SIZE, DB_MSSQL_TRUST_BATCH_RETURNING
```

Explicitly NOT in the PR:

- `api/src/utils/is-primary-key.ts` — dead without Bucket D.
- Deletion of `api/src/request/request-tracker.ts` — doesn't exist on upstream.
- `tests/blackbox/utils/set-directus-env.ts` — confirm upstream doesn't have it; if it's tied only to Bucket A tests,
  IN. Otherwise OUT.
- Any `.github/` or `docker-compose.yml` change from `bc36dfd2aa` / `ce1fa86f40`.

## Materialization strategy

**Cherry-pick will not work** (disconnected histories). Use direct port:

1. `git switch feature/batch-insert-upstream` (already at `upstream/main`).
2. Create new files in `capabilities/dialects/*` by hand from the fork copies, adjusted to extend
   `CapabilitiesHelperDefault` (upstream's pattern) rather than `CapabilitiesHelper` directly. Update
   `capabilities/index.ts` and `capabilities/types.ts`.
3. Open upstream's `items.ts` `createOne` (lines 8–307) and refactor it in place:
   - Move the bulk into `createMany` body.
   - Replace the single-row `trx.insert(...).returning(...)` with
     `if (await getHelpers(trx).capabilities.preservesInsertOrderInReturning()) { /* batchInsert */ } else { /* per-row loop with returningOptions */ }`.
   - Batch the `activityService.createOne` / `revisionsService.createOne` into `createMany`.
   - Re-shape `createOne` to `const [pk] = await this.createMany([data], opts); return pk`.
4. Drop the fork's filter/error/skipable coupling per the table above as you go.
5. Copy `batch-insert.test.ts`, `extensions/query-counter/`, `extensions/env-inject/` verbatim (these are net-new on the
   fork; should apply cleanly).
6. Run prettier across changed files.
7. Single commit (squash all of the above):
   `feat(items): use knex.batchInsert for vendors with reliable RETURNING order`.

## Verification

After the port:

1. `pnpm install` (workspace bootstrap on the upstream baseline).
2. `pnpm --filter api typecheck` → clean.
3. `pnpm --filter api test` (unit) → clean.
4. `git diff upstream/main -- api/src/services/items.ts` should contain ONLY:
   - The `createOne` collapse.
   - The vendor-bucketed dispatch.
   - The activity/revisions batching.
   - **Zero** mention of `items.db.insert`, `throwDatabaseError`, `isPrimaryKey`, payload-null short-circuits, async
     `emitAction`, default-PK-sort.
5. Blackbox: `pnpm --filter tests-blackbox test` against postgres + sqlite + mysql + maria + mssql + oracle. The
   `batch-insert.test.ts` `isReliableBatchVendor(vendor)` partition must match the capability dispatch.
6. Sanity-grep on the diff:
   `grep -nE 'items\.db\.insert|throwDatabaseError|isPrimaryKey|isNotPrimaryKey|DEFAULT_ORDER_READS_BY_PK'` — must
   return nothing.

## Design decisions (locked to PR #43)

User directive: stick to the design established during PR #43. The questions previously raised are answered as follows:

- **MSSQL trigger-modifications**: trust mode (`DB_MSSQL_TRUST_BATCH_RETURNING=true`) routes through `knex.batchInsert`,
  which doesn't carry the `{ includeTriggerModifications: true }` option — so trust mode is **not compatible with
  triggered MSSQL tables**. Document in the PR description. The default path (trust mode off) still goes through
  upstream's `createOne` via the per-row loop branch, which retains `includeTriggerModifications` — so out-of-the-box
  behavior is unchanged for triggered tables.
- **`opts.overwriteDefaults` indexing**: positional via `opts.overwriteDefaults?.[index]` in the batched prep loop,
  matching the fork's PR #43 semantics. Already applied.
- **Env-var naming**: `DB_BATCH_INSERT_CHUNK_SIZE` and `DB_MSSQL_TRUST_BATCH_RETURNING` verbatim from PR #43. Already
  applied.
- **`DB_DEFAULT_ORDER_READS_BY_PK` default = `true`**: matches PR #43. Behavior change for existing deployments — flag
  it in the release-note bullet but ship the default as `true`.

## Out of scope (do not include in the first PR)

- Buckets B–I above.
- The fork's per-dialect dialect-helper file restructure (only add the files we need).
- Any docs updates beyond the two new env vars.
- The `.bak` file and the uncommitted `tests/blackbox/setup/sequential-tests.ts` change on the fork.
