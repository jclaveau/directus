# Plan — Separate fork changes into upstreamable buckets; first PR = `insert → batchInsert`

## Context

Branch `feature/make_batch_insert_prable_6` carries ~30 fork-specific commits ahead of `upstream/main` (now at `d6e706e647`). Many of them entangle in `api/src/services/items.ts` (912 lines of diff vs upstream), and the next goal is to **open a first PR to `directus/directus` containing ONLY the `insert → batchInsert` refactor** — no other fork features. To do that we first inventory what's actually on the branch, classify each commit by feature concern, and identify the coupling points that need to be removed when extracting the batch-insert change for upstream review.

This plan is a triage + extraction strategy. It does not yet write the upstream PR branch.

## Phase 1 — Inventory of fork commits touching `items.ts`

Cut-off between fork and upstream is between commits `4c07cca6f7` (ours, oldest fork commit) and `3961dc0593` (upstream "Add key/value information to db errors"). From `git log upstream/main..HEAD -- api/src/services/items.ts`:

| # | SHA | Subject | Concern |
|---|-----|---------|---------|
| 1 | `d178f4387e` | refacto: move IsPrimaryKey type guard to utils | **batch-insert** support (extracts `isPrimaryKey`/`isNotPrimaryKey` to `api/src/utils/is-primary-key.ts`) |
| 2 | `32d1a39ce0` | refacto: returning ids support in the database helpers | **batch-insert** (moves dialect probe into `api/src/database/helpers/capabilities/dialects/{postgres,oracle,sqlite,mssql}.ts` + base `types.ts`) |
| 3 | `76adb1ca48` | perf: explain why MariaDB / Mssql do not support returning | **batch-insert** (comment-only) |
| 4 | `aa999c51de` | perf: support batchInsert for Sqlite >= 3.35 | **batch-insert** (sqlite version probe + test branch) |
| 5 | `f277d4f879` | style: format | **batch-insert** (prettier sweep over the above) |
| 6 | `8e936467f2` | refacto: use batch insertMany for every insert #6 | **batch-insert** — THE big rewrite: collapses `createOne`→`createMany`, deletes 834 lines of fallback, also deletes dead `api/src/request/request-tracker.ts` |
| 7 | `7f338f5deb` | perf: do not emit read events during update | **other** — `update*` only |
| 8 | `776d93cc7b` | feat: allow skipping update via hooks && skip update of no fields | **other** — `update*` only |
| 9 | `896fe04840` | perf: use where instead of whereIn if keys length is 1 | **other** — lock-scope perf |
| 10 | `415ea65521` | feat: filter event for db.insert #32 | **other** — adds `items.db.insert` / `items.db.inserted` filters; current batch-insert code calls them at items.ts:388, :416 |
| 11 | `ee343a26a2` | feat: make db errors filterable #34 | **other** — replaces `translateDatabaseError` with `throwDatabaseError`; current batch-insert code uses `throwDatabaseError` at items.ts:451 |
| 12 | `bc36dfd2aa` | perf: hide console.logs and fix cockroachdb version | **other** — also touches `.github/workflows/blackbox.yml` and `docker-compose.yml` |
| 13 | `2dd0d1255b` | ci(mysql): fix createMany for MySQL, MariaDB and Sqlite | **batch-insert** (the "fallback bucket" work, later deleted by #6 above) |
| 14 | `7311d5cc4d` | perf: store activity and revision row with createMany | **batch-insert** (batches the side-effect writes) |
| 15 | `7a3f613503` | feat: fix action-verify-create test | **batch-insert** (test fix for #16 below) |
| 16 | `47833fd312` | perf: createMany batched | **batch-insert** |
| 17 | `438dffd0e6` | feat: batched insert many filterable by create event | **batch-insert + other** — couples `createManyAtOnce` introduction with `items.db.insert*` filter calls |
| 18 | `1ebf833129` | fix: data instead of itemsValus during translateDatabaseError | **batch-insert** (typo fix in #17) |
| 19 | `1d7d86c048` | feat: support of batchInsert() | **batch-insert** — initial introduction |
| 20 | `4c07cca6f7` | feat: filter items creation by returning null or PK | **other** — PR #23 (skipable creation via filter) |
| 21 | `1ddb16ee04` | feat: optionnally async emitAction | **other** — emitter API change, not items.ts logic |

Plus uncommitted: `tests/blackbox/setup/sequential-tests.ts` (single file in `git status -s`), and the stray `api/src/services/items.ts.previous-claude-refacto.bak` to discard.

## Phase 2 — Bucket summary (what each upstream PR would carry)

### Bucket A — `insert → batchInsert` (this is the FIRST upstream PR)

What it does: replaces the per-vendor fallback maze in `createOne`/`createManyAtOnce` with a single dispatch — vendors that reliably preserve `INSERT … RETURNING` order use `knex.batchInsert(...).returning(pk)`, others use a per-row loop — and collapses `createOne` to a thin `createMany([data])` wrapper. Adds `DB_BATCH_INSERT_CHUNK_SIZE` and `DB_MSSQL_TRUST_BATCH_RETURNING` env vars.

Source commits (squash candidates, in order): **#19, #18, #17, #16, #15, #14, #13, #6, #5, #4, #3, #2, #1**.

Files touched by this bucket:
- `api/src/services/items.ts` — `createOne` (now 3-line wrapper), `createMany` (real implementation), drops `createManyAtOnce` + ~500-line fallback re-query path.
- `api/src/utils/is-primary-key.ts` (new) — `isPrimaryKey` / `isNotPrimaryKey` type guards.
- `api/src/database/helpers/capabilities/types.ts` — adds base `preservesInsertOrderInReturning(): Promise<boolean>` (returns false).
- `api/src/database/helpers/capabilities/dialects/{postgres,oracle,sqlite,mssql}.ts` (new) — per-dialect overrides; sqlite probes server version ≥3.35; mssql opts in via env.
- `api/src/database/helpers/capabilities/index.ts` — wires the new dialect classes.
- `tests/blackbox/tests/db/routes/items/batch-insert.test.ts` (new) — vendor-bucketed assertion (`isReliableBatchVendor`).
- `tests/blackbox/extensions/query-counter/index.mjs` (new) — count-INSERT spy extension.
- Removed: `api/src/request/request-tracker.ts` (dead code that #6 cleaned up — verify upstream `main` still has it before including the deletion).

### Buckets B–I — later PRs, NOT in the first one

- **B: `items.db.insert*` filter events** (PR #32-equivalent) — commits **#10, partially #17**. Needs to be split out: the filter calls at `items.ts:388-400` and `:416-428` were added by #17 and now live inside the batch dispatch.
- **C: filterable db errors** (PR #34-equivalent) — commit **#11**. Affects the `throwDatabaseError` import + call at `items.ts:451` and a `fields.ts` edit.
- **D: skipable item creation via filter** (PR #23-equivalent) — commit **#20**. Lives in `createMany`'s `items.create` filter handling (`items.ts:210` and the `isPrimaryKey` short-circuit at the top of the per-item prep loop).
- **E: optionally-async emitAction** — commit **#21**. Touches `emitter.ts`, `items.ts` await sites, `types/items.ts`.
- **F: lock-scope perf (`where` vs `whereIn`)** — commit **#9**.
- **G: skippable update / skip empty update** — commit **#8**.
- **H: skip read events on update** — commit **#7**.
- **I: console.logs + cockroachdb workflow fix** — commit **#12**. Mostly CI/docker, low-value upstream — fold the items.ts piece (cleanup logs) into the batch-insert PR if minimal; drop the rest.

## Phase 3 — Coupling points to remove from the FIRST PR

Today's `items.ts` (HEAD) has three non-batch features bleeding into the batch dispatch path. For the upstream PR these must be reverted to upstream behavior:

| Line(s) | Current (fork) | Required for upstream PR |
|---|---|---|
| `items.ts:388-400` | `dbQuery = await emitter.emitFilter('items.db.insert', dbQuery, …)` | **Delete.** Bucket B carries this. |
| `items.ts:416-428` | `filteredResult = await emitter.emitFilter('items.db.inserted', insertedRows, …)` | **Delete** — iterate `insertedRows` directly. Bucket B. |
| `items.ts:451` | `await throwDatabaseError(err, data)` | Replace with upstream's `throw await translateDatabaseError(err, …)`. Bucket C. |
| `items.ts:210, 647` | `items.create` filter return-value handles `isPrimaryKey(result)` short-circuit | Drop the short-circuit branch; keep only upstream's filter+payload semantics. Bucket D. |
| various `await emitter.emitAction(...)` | Always awaited | Match upstream sync/async semantics — verify per-call. Bucket E. |

Concrete extraction strategy:

1. Branch off `upstream/main`: `git switch -c upstream-pr/batch-insert upstream/main`.
2. Cherry-pick the **batch-insert** commits in chronological order (#19 → #1). Expect heavy conflicts in #6 (the big rewrite) — resolve by keeping the upstream-clean version of each touchpoint above, using the fork's current `api/src/database/helpers/capabilities/dialects/*` files as reference for the dispatch logic.
3. Squash all into one commit with a clear message; this becomes the upstream PR.
4. Smoke-test locally (`pnpm --filter api typecheck`, blackbox `batch-insert.test.ts` against postgres + sqlite + mysql + oracle).

If cherry-picking #6 is too conflict-heavy (likely — it's a 1000-line negative diff), an alternative is to **rewrite from upstream**: copy the current fork's `createMany` body into upstream's `items.ts` and prune the four coupling points by hand. End state is identical; pick whichever takes less time.

## Critical files

- `api/src/services/items.ts` (HEAD: lines 350–470 contain the entire batch dispatch — this is the surface to keep in the upstream PR).
- `api/src/utils/is-primary-key.ts`
- `api/src/database/helpers/capabilities/dialects/{postgres,oracle,sqlite,mssql}.ts`
- `api/src/database/helpers/capabilities/{types.ts,index.ts}`
- `tests/blackbox/tests/db/routes/items/batch-insert.test.ts`
- `tests/blackbox/extensions/query-counter/index.mjs`

## Verification

1. On the new `upstream-pr/batch-insert` branch:
   - `pnpm --filter api typecheck` — must be clean.
   - `git diff upstream/main -- api/src/services/items.ts` — should show ONLY the batch dispatch + `createOne` collapse; no `items.db.insert*`, no `throwDatabaseError`, no skipable-creation branch, no async-emitAction churn.
2. Blackbox: bring up postgres + sqlite + mysql + oracle, run `tests/db/routes/items/batch-insert.test.ts` and `tests/db/routes/items/no-relation.test.ts`. Branch-vs-loop assertion via `isReliableBatchVendor(vendor)` must hold.
3. Run the upstream test suite (`pnpm --filter api test`) to confirm no unit regressions from the createOne→createMany collapse.

## Out of scope (for the first PR)

- Buckets B–I above — track separately, each its own PR.
- Docs for `DB_BATCH_INSERT_CHUNK_SIZE` and `DB_MSSQL_TRUST_BATCH_RETURNING` in `docs/` — include in the upstream PR description, decide with maintainers whether they want a docs commit in the same PR.
- The current `.bak` file (`api/src/services/items.ts.previous-claude-refacto.bak`) — discard locally; do not include in any PR.
- The uncommitted `tests/blackbox/setup/sequential-tests.ts` change — review and either commit on the fork or discard; not for the upstream PR.
