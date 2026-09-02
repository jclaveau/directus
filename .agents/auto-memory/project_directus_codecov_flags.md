---
name: project_directus_codecov_flags
description:
  This fork's codecov runs per-package patch flags; blackbox coverage is NOT in the api unit flag, so blackbox-only code
  fails codecov/patch/api
metadata:
  type: project
---

Codecov on jclaveau/directus PRs posts a `codecov/patch/<pkg>` + `codecov/project/<pkg>` per workspace package. Patch
target = auto ≈ project% (~68%), not 100% (no `codecov.yml` in repo). `compose`/`compose-hhh-main` always fails
(App-token lacks `workflows`) — ignore.

- **Blackbox coverage is NOT uploaded to the `api` (unit) flag.** Code exercised only by `tests/blackbox` shows as
  uncovered patch under `codecov/patch/api`. New api logic needs real **unit** tests (knex-mock-client) to clear patch.
- Seen on #46 (batch-insert): the per-dialect `CapabilitiesHelper` overrides
  (`api/src/database/helpers/capabilities/dialects/*`) and the `createMany` batchInsert/per-row dispatch were
  blackbox-only → patch/api red. Fixed with `capabilities.test.ts` (all dialect methods) + `createMany` unit tests
  (batch vs per-row vs empty).
- #50 (skip-noop): a new `@directus/constants` barrel line `export * from './items.js'` was the uncovered patch line
  until the test imported `ALTERATIONS_KEYS` _through_ `./index.js` instead of the leaf.

**How to apply:** before pushing an api/constants PR here, run the changed package's coverage locally and intersect
uncovered lines with the diff; expect blackbox-covered paths to still need unit tests. General mechanics in
[[reference_codecov_patch_coverage]]. CI gate context in [[project_directus_fork_integration_branches]].

## codecov/patch made REQUIRED on v11.10.1-prepare + the integration-only ignore policy

`codecov/patch` (aggregate, target auto) is now a **required** check on `v11.10.1-prepare` (project stays
report-only — base-drift noise on a stacked line). Config lives in **`codecov.yaml`** at repo root.

- **Integration-only code can't feed the unit patch flag → codecov-`ignore` it** rather than chase coverage.
  `ignore:` lists `api/src/controllers` (HTTP guards) and `api/src/auth/drivers` (LDAP/SSO/OAuth callbacks,
  exercised via a real IdP/login, not vitest). Otherwise they red every PR touching them (#104, #152).
- **codecov.yaml is read from the PR's tree (merge ref), not just the default branch.** An ignore-list change
  on `prepare` reaches a stacked feat/renovate branch only once it **inherits** it — merge `prepare` in
  (refresh) or `git checkout origin/v11.10.1-prepare -- codecov.yaml` onto the branch.
- **A helper added by a fix-forward needs its own unit test** to clear patch (export it + co-located `.test.ts`):
  done for `getRedisConnection` (#124), `redactHeaders`. Watch circular-import walls importing a driver module
  under vitest (ldap.ts router setup threw `Route.post() … undefined`).
- Drift: the `**/*.config.{ts,js}` ignore from #186 is NOT on prepare's current codecov.yaml — build-config PRs
  may need it re-added.

## ignore vs real-gap: integration-only ≠ all-uncovered (the #104 lesson)

- **`ignore: api/src/controllers` works recursively** (bare dir path). A red `codecov/patch` on a controller-touching
  PR is NOT proof the ignore is broken — check WHERE the diff's new lines are.
- **#104 "v11.10.1-feat: 07 — reasons on ForbiddenErrors" stays red even with controllers ignored**: the feature spread
  `throw new ForbiddenError({reason})` across ~11 SERVICES (collections/users/fields/relations/schema/…) + 2 utils, not
  just controllers. Services are the **unit-testable surface** → those new deny-branch lines are a LEGITIMATE missing-test
  gap, NOT ignorable. Fix = unit tests triggering each service's forbidden branch (mock accountability to deny); services
  already have `.test.ts` → adding cases, not scaffolding.
- **bb-coverage ([[project_directus_blackbox_coverage]]) would cover the service deny-branches too** — but only once the
  stack recomposes on build-tsdown (bb needs tsdown). Until then: add unit tests, or leave non-blocking (codecov/patch
  required only on prepare, so mid-stack feats aren't truly gated).
- Diagnose split: `git diff $(git merge-base <base> <head>) <head> --stat -- 'api/src/**/*.ts'` → controllers (ignored)
  vs services/utils (real gap).

## Greening the feat PRs (2026-06): unit tests for dialect helpers, codecov-ignore for glue

After the controllers ignore was DROPPED (chain recomposed on bb, see [[project_directus_linear_chain_leaf_pr]]),
every feat PR's diff lines count → had to green each via tests or targeted ignore:

- **dialect schema helpers = pure unit wins** (#98 dropUnique/dropIndexIfExists, #99 getColumnsWithInvalidCollation):
  `vi.fn`-mock knex (assert emitted `raw`/`alterTable` calls) OR knex-mock-client for SQL assertions → 90%+ patch.
- **knex-mock-client gotchas**: match a `schema.table` query with a **RegExp** (`tracker.on.select(/information_schema/i)`),
  the string form `'information_schema.columns'` misses → "Mock handler not found". MockClient **inlines binding values
  into `.sql`** (assert on `.sql.toLowerCase()`, not `.bindings`). `tracker.reset()` in afterEach; fresh mock per test.
- **CIRCULAR IMPORT under vitest**: importing a `schema/dialects/*` file directly pulls `schema/types.ts` →
  `database/index.ts` → `schema/index.ts` → `cockroachdb.ts` → back to `types.ts` (SchemaHelper still undefined) →
  `TypeError: Class extends value undefined`. Fix: `vi.mock('../../index.js', () => ({ default: vi.fn(),
  getDatabaseClient: vi.fn(() => 'postgres') }))` at the top of the test (same wall as the ldap.ts case).
- **integration glue → targeted codecov-ignore** (not unit-testable): extracted the COVERAGE_DIR dump from server.ts
  into `api/src/utils/dump-coverage.ts` so it can be file-ignored cleanly; ignore that + `tests/blackbox/merge-coverage.mjs`
  + `api/src/controllers/extensions.ts` (extension install needs a live registry, no blackbox harness).
- Verify the tests locally before pushing — [[feedback_local_vitest_env_constrained]].

## Reading codecov on a multi-flag PR — DON'T trust intermediates (the #104 lesson)

- **Mid-flight aggregate `codecov/patch` numbers are GARBAGE; only the final aligned value gates.** After a push, each flag (unit/api + 6 blackbox DB legs + per-pkg) uploads separately over ~20 min. Between uploads codecov posts a partial aggregate computed against an incomplete report — saw #104 swing **9.5% → 17% (blackbox only) → "563 misses / 11%" (impossible: a 22-line diff showed 111 patch misses, `permissions.ts` "regressed" 100%→0%) → finally 65.36% SUCCESS**. A poll that stops on the first `FAILURE` conclusion fires on an intermediate. **Wait for ALL CI on the head to finish (esp. the slow blackbox matrix) before reading the patch %.**
- **`codecov/patch/<flag>` per-flag statuses are `informational: true` (default_rules) → always "SUCCESS"** regardless of real coverage. They tell you NOTHING. Only the aggregate non-flag **`codecov/patch`** (target auto, `informational:false`) blocks. Don't read a green `codecov/patch/api` as "my tests landed".
- **Blackbox integration coverage does NOT cover deny/forbidden branches.** Adding the `Run Blackbox` label to #104 only moved aggregate 9.5%→17% — happy-path suites use admin tokens; "user X is forbidden" branches stay unhit. The real lever for `throw new ForbiddenError` lines is **unit tests** (mock accountability to deny). Blackbox's value is controllers/glue, not service guards.
- **Label-gating quirk**: `gh pr edit --add-label` silently no-ops here (classic-Projects GraphQL abort, see [[gh-issue-view-quirk]]) — use `gh api repos/<o>/<r>/issues/<N>/labels -X POST -f 'labels[]=Run Blackbox'`. The `labeled` PR event then fires `blackbox-pr.yml` (gate `contains(labels,'Run Blackbox')`).
**Read a FLAG's absolute coverage per commit via the codecov API** (the commit endpoint has no flag breakdown; the
report endpoint filtered by flag does):
```
curl -s "https://api.codecov.io/api/v2/github/jclaveau/repos/directus/report/?sha=<FULL_SHA>&flag=blackbox" \
  | python3 -c "import sys,json;t=json.load(sys.stdin)['totals'];print(t['coverage'],t['lines'],t['hits'])"
```
Used to prove sharding preserved coverage: `blackbox` flag 43.04% pre-shard vs 43.05% post — the union of sharded
partial uploads equals the full-run coverage (codecov merges by flag server-side). See [[project_directus_blackbox_sharding]].

**Per-file DIFF-LINE coverage (which added lines are missed) — codecov v2 COMPARE endpoint** (the codecov PR
comment only prints the % + "N lines missing", never the lines):
```
curl -s "https://api.codecov.io/api/v2/github/jclaveau/repos/directus/compare?pullid=<N>" | python3 …
```
Returns `files[].lines[]` with `{value, number:{head}, coverage:{head}, added}`. Caveat: `coverage.head` here is
ONE session's view (a file the api-unit session never loaded shows all-0 even though the MERGED aggregate covers
it) — a line is HIT if ANY session has >0, so union across sessions; don't read a single field as the merged truth.
2026-07-27: the 3 real merged-missed lines on #306 were the extension-registration/context-wiring lines
(`scopedCache: createScopedCacheExtensionHandle(getSchema)` in manager/flows) — integration-only, only the blackbox
flag covers them, so a flaky/failed blackbox shard dropping its upload reds the blocking aggregate patch even though
per-flag patches pass. Consider `ignore:` for such inherently-integration-only wiring, like the controllers glue.

**The aggregate `codecov/patch` target is 95%, not `auto`.** PR #326 read
*"patch coverage (92.88%) is below the target coverage (95.00%)"* while EVERY per-flag
`codecov/patch/<pkg>` passed — only the roll-up fails, so the per-flag greens tell you
nothing. Codecov folds its impacted-file list behind a `<details>`, so compute the gap
locally: `vitest run --coverage --coverage.reporter=json --coverage.include='<file>'`,
then intersect `coverage-final.json` (`statementMap` + `s[id]===0`) with the PR's added
lines from `git diff -U0 <base>...HEAD`. That named the exact 36 api + 40 app lines.

**`codecov/patch` goes red transiently — never judge it before every flag reports.**
Seen twice on PR #358 (2026-08-17): the aggregate `codecov/patch` status flips to
**fail** while `Unit Tests (api)`, `Unit Tests (rest)` and the blackbox shards are still
running, because it is computed from whatever flags have uploaded so far — and a diff
living in the api + blackbox flags looks uncovered until those two land. Both times it
turned green with no code change once all flags reported. Check
`gh pr checks <N> --json name,bucket` for `pending` rows before chasing uncovered lines.
