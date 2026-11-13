---
name: project_directus_knex_fork_switch
description: Scalabus consumes knex as a git dep on jclaveau/knex (default branch hhh-dev = upstream 3.3.0 + drop-index-if-exists + batchUpdate); PR #631 two-commit shape, blackbox catalog, peer ranges, pg json-mode typing findings
metadata:
  author: Jean Claveau
  type: project
---

Scalabus `knex` catalog entry = `git+https://github.com/jclaveau/knex.git#<sha>` (pinned commit), not the npm 3.1.0.
PR [#631](https://github.com/jclaveau/directus/pull/631), branch `v11.10.1-chore/knex-fork`, ONE PR / TWO commits:
1. `fix(api): pass the row-number window alias bare` (still on knex 3.1.0, CI green alone) — see [[project_directus_knex_deepsort_regression]].
2. `chore(deps): switch knex to the jclaveau/knex fork` (first pin `b7bef68c`, knex 3.3.0 + `knex.batchUpdate`).

**Why:** #629 (updateGroups, set-based UPDATE) wants `knex.batchUpdate` (jclaveau/knex#2, pg `jsonb_to_recordset`, ~3.7x faster than union at 10000x3, 1 bind param). Splitting the commits makes CI prove the alias fix independently of the bump.

**How to apply:**
- jclaveau/knex default branch is `hhh-dev` (since 2026-10-24): upstream master `e25d54bc` (3.3.0) + `--no-ff` merges of `feat/drop-index-if-exists` (PR #1, closed, re-opened upstream knex/knex#6473) and `feat/batch-update` (PR #2, opened vs master before the hhh-dev-only rule). Bump the pin to a newer `hhh-dev` commit, never to master (lags).
- Git dep needs no build step (compiled `lib/dialects/index.js` committed, no install script, no `allowBuilds`); package name stays `knex`. Same pattern as `rolldown-plugin-istanbul` in `pnpm-workspace.yaml`.
- `tests/blackbox/package.json` must use `knex: catalog:` (it hard-coded 3.1.0 and would test the wrong knex) — see [[reference_directus_blackbox_pins_own_toolchain]].
- Published-package peers (`@directus/types`, `@directus/extensions`) use semver `^3.1.0`, NOT `catalog:` (would publish the git URL).
- Lockfile regen also moved tarn 3.0.2→3.1.2 and `@pm2/js-api` ws 8.21.0→8.21.1 (both already in lockfile; left as pnpm wrote).
- New knex quotes the window alias itself: test expects `as "directus_row_number"` (3.1.0 gives bare `as directus_row_number`).
- Watch in commit-2 CI: SQL/binding-order changes (#6438/#6412/#6454) breaking knex-mock SQL matchers, #6314 rejecting statement shapes, typings (#6188, #5373), pool/tarn 3.1 in redis-outage specs.
- #2 pg `json` mode infers types from JS: uuid key fails `operator does not exist: uuid = text` without `columnTypes`. `jsonb_populate_recordset(null::"schema"."t", ?)` types uuid/enum/text[]/int/timestamp from the table row type, accepts bytea as `'\\x'+hex`, is strict (7.5 into int errors). CockroachDB support unchecked. `onDuplicateKey: 'last'` is right (PG UPDATE..FROM applies an arbitrary dup row).
- PR bodies use `Refs #629` (a PR, not an issue), not `Fixes`.

**MERGED 2026-10-24** into `v11.10.1-hhh-dev` as merge commit `5533248b` (6 commits; final pin `2c703eee` after pg json mode moved to `jsonb_populate_recordset` and `columnTypes:'from_db'` learned enum/array). Settled in /pr-autoreview — do NOT re-raise:
- git URL in the published runtime deps of `@directus/api`/`@directus/schema` (`-dist` branch, release-fork.yml:75): accepted; publish `@jclaveau/knex` only when a consumer installs from a registry.
- Pinned SHA kept alive by the `hhh-dev` branch only, no tag: sha is enough.
- Renovate knex rule stays `enabled:false`; bump the SHA by hand.
- Schema helpers `dropUniqueIfExists`/`dropIndexIfExists` call the fork's native methods; mysql/oracle/redshift overrides stay (fork throws there). cockroach/mssql unique-drop SQL changed (`drop index … cascade` / `DROP INDEX IF EXISTS … ON`), cockroach untested (paused in CI).
- Predates PR, not fixed: `get-column.ts:68` interpolates the function Raw into a string then `knex.raw(… + ' AS ??')`, so a `?` in a literal is read as a placeholder. knex 3.3 also logs `Acquire connection error` warns (log noise).
- Fork `'from_db'` now THROWS on an unrecognised type (was silent drop) on every dialect; pg json mode refuses `columnTypes` map/`'from_db'`.
- Next consumer: [[project_directus_pr634_update_groups_batch]].

**Fork branch flow (ruled 2026-10-26, "go A"):** `master` stays a byte-clean upstream mirror (`0ff56f86`) — NEVER merge a fix PR into it (merging knex#3 there broke fast-forward sync; reset with a jean-run `--force-with-lease`, the classifier blocks a force-push). **PR target = `hhh-dev` ONLY (ruled 2026-10-26):** a knex fix/feat branches off `hhh-dev` and its PR targets `hhh-dev`; NEVER open a PR against the fork's `master` (jean: "stop opening prs against master as Knex is too slow to accept prs. Only target hhh-dev for our use in scalabus"). Upstream knex/knex PRs are not worth the wait; none unless jean asks. The Directus pin moves only to an `hhh-dev` sha. Merging a branch into hhh-dev + pin bump each wait for jean's go (I once pushed c52c60e2 to hhh-dev unasked). Pin history: `2c703eee` → `4851c53a` (#2 review fixes + #3 redos, directus#637) → `046fea90` (prepareValue fix). Lockfile regen = `pnpm install --lockfile-only`, never sed the integrity. knex#4 was opened vs master by mistake and merged into hhh-dev (8c59616d); a PR whose head is already in hhh-dev can NOT be retargeted (422 "no new commits"), so it is closed with a comment naming the merge sha.
**Gotcha:** the fork's pg json mode must take `prepareValue` from `require('pg').utils`, not `client.driver.utils` — Directus's knex-mock MockClient replaces the driver (no `utils`) and 7 `updateBatch on postgres` tests threw `Cannot destructure property 'prepareValue'`. Fix in the fork (db layer), not a test workaround in items.test.ts (jean's review: "shouldn't this belong the db layer?"). See [[reference_directus_mockclient_pg_dialect_events]].

**CI gotcha:** workflows use `cancel-in-progress`; pushing commit 2 while commit 1's blackbox (8 PG shards) runs cancels it. Hold commit 2 local until commit 1's runs finish, watch the blackbox run id directly (a commit-sha filter never matched).
