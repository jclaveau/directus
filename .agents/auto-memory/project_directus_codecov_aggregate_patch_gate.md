---
name: project_directus_codecov_aggregate_patch_gate
description: The BLOCKING codecov check on this fork is the unflagged `codecov/patch` at a hard 95% — every per-package flag is informational; blackbox coverage feeds it but attributes coarsely, so bb-only code cannot clear the bar
metadata:
  author: Jean Claveau
  type: project
---

`codecov.yaml` (repo root, this fork — upstream has none):

- `coverage.status.patch.default: target 95%, informational: false` → **this is the
  only blocking coverage check.** Not `auto`, and not per-package.
- `project.default: informational: true`.
- `flag_management.default_rules.statuses`: patch target 80%, **`informational: true`**
  → `codecov/patch/api`, `/blackbox`, … are all report-only and pass regardless.

So a red `codecov/patch` is real and blocks; a red `codecov/patch/<pkg>` is noise.
Corrects the older "patch target = auto" note in [[project_directus_codecov_flags]].

**Blackbox coverage DOES feed the aggregate** (the `ignore` list for controllers was
dropped when the `blackbox` flag landed) — but it comes from the *bundled instrumented*
build, so line attribution through the sourcemap is coarse: **a multi-line statement
credits its first line and reads MISS on the rest.** Proof from #358: the recovery
suite drives `retryPendingScopedCachePurges` end to end and it still showed uncovered,
while `schedule.ts` (unit-covered, source-level) showed every line hit.

Consequence: **the 85-column style makes almost every statement multi-line**, so
bb-only code lands near 20% on the aggregate. Unit tests are the only way to clear 95%.
#358 went 61.85% → 97.11% by adding them, then 99.23% once bb uploads merged.

**How to apply:** compute locally rather than guessing — intersect
`git diff -U0 <base>...HEAD` added lines with `coverage-final.json` statementMap counts
(v8 provider; codecov counts partials against you, so check `branchMap` too).
A failing blackbox shard leaves the upload incomplete → `codecov/patch` reds for that
reason alone; fix the shard before reading the number.

**Read the misses instead of guessing (2026-08-19).** `report/?sha=<sha>&path=<file>`
returns full per-line coverage where `file_report/` returns empty — intersect with
`git diff -U0 <base>...HEAD` added lines and you reproduce codecov's number exactly
([[reference_codecov_patch_coverage]]). On #366 that split 13 misses into two kinds:

- **3 real** — a `catch` arm nothing reached (`@keyv/redis` resolves a failed command
  instead of throwing, so the probe's try/catch never fired). Worth a test.
- **9 instrument** — the bundled build credits a multi-line statement only on its
  FIRST line, so a 4-line call scored 1 hit and 3 misses on lines that cannot fail to
  run. Collapsing to one statement per line where the 85-col gate allows is legitimate,
  not gaming. The verticalized ternary it *requires* stays uncovered; 96%+ cleared the
  gate without chasing it.

**A test can claim a branch it never runs.** `cache.test.ts`'s "narrows CACHE_STORE=redis
through the store ternary" got the memoized memory-store instances back from an earlier
test, so `getConfig`'s redis half never executed while the assertion passed. Building a
different store needs `vi.resetModules()` + a dynamic re-import.

**`tests/blackbox`'s `tsc --noEmit` passes vacuously** — it aborts on two tsconfig
option errors before checking anything ([[reference_gate_can_pass_vacuously]]).

**A `git mv` re-charges every line the file never covered.** codecov scores the *diff*,
and a moved or extracted file arrives as added lines — including the ones no test ever
reached at the old path, which cost nothing while they sat in an untouched file. PR #472
(pure refactor, zero behaviour change) landed at 79.36% against the 95% target: 26 misses,
all pre-existing dead spots in `pool.ts` and the pm2 calls lifted into
`supervisor/lib/client.ts`. Budget a coverage pass into any move of code that isn't
already near 100%, and read the per-file split with the compare API
(`api.codecov.io/api/v2/github/<owner>/repos/<repo>/compare/?pullid=<n>`, each file's
`totals.patch`) rather than guessing which file dragged it down.

Also: the flagged `codecov/patch/api` and the unflagged `codecov/patch` can report the
**same percentage** and still read differently — the flag's status is 80% but
`informational: true`, so always SUCCESS; the gate's target is 95% and blocks. A green
`patch/api` says nothing about the blocking check.

**A comment appended to an upstream line puts it in the patch (#769, 2026-11-26).**
About 330 `bb-out-of-scope` tags held the patch at 50-60% while the added code was
57/57 covered; more bb scenarios moved it 57.0 → 60.6% only.
- `codecov.yaml` `ignore` takes paths, never lines. `/* v8 ignore */` also blinds the
  branch audit, which reads the same coverage.
- `database/index.ts` answers `'mysql'` for MariaDB: `dialects/mysql.ts` is supported
  code, never ignore it as dead.
- API rate-limited → download the run's unit + blackbox `coverage-final.json`
  artifacts and intersect with the diff. Compare two heads with the SAME diff command
  (a diff missing files gave 62.9% instead of 60.1%).
- An artifact count still reads high: on `151f8a1780` it gave 44 missing lines,
  codecov's per-line status 72. Codecov marks a handler's first line
  (`asyncHandler(async (req, res, next) => {`) uncovered while its body has unrun
  parts. Take the final list from codecov's per-line status when the API answers.
- Tests alone cannot reach 95% there: all 72 misses were tagged lines (added lines
  73/73 covered), 35 of them MariaDB/sqlite/cockroachdb/redshift/non-PG branches
  (#610) a Postgres-only CI never runs; the ~30 coverable ones top out near 87%.

**Chosen lever (jean "go A", 2026-11-26): strip tagged ranges from the codecov copy.**
A script beside `branch-audit.mjs` removes the counters of each `// bb-out-of-scope:`
tag's whole range (the audit's tag-to-range logic) before the `blackbox.yml` and
`check.yml` uploads. The `coverage-final.json` artifacts stay raw for the audit.
`bb-unit-only` stays counted: codecov merges unit + bb, and none of #769's 4 such tags
was among the 72 misses. Landed in `635129ce9b` (`strip-out-of-scope.mjs`):
`codecov/patch` 74.00 → 100.00%, all CI runs green.
- Reading `coverage-final.json` in any script: unit coverage ends some ranges at
  `column: null` (= end of line); a plain position compare gets NaN and silently
  matches nothing.
- Rejected: ignore comments (blind the audit and unit coverage); a separate oos
  `flag` (a flag adds a status, cannot take lines out of the unflagged check);
  dedicated oos jobs as the fix (~30 lines, ~87% ceiling) — possible later PR, their
  artifacts named so the audit skips them.

**A lazy `await import()` inside an action body is an uncovered line until something
runs the action (PR #492, 2026-09-15).** Making every CLI command lazy turned 16
one-line `.action(...)` bodies into misses and failed the gate. What cleared it: an
`it.each` wiring table in `api/src/cli/index.test.ts` — `vi.mock` every command
module, `createCli(argv)` + `program.exitOverride()` + `parseAsync(argv, { from:
'user' })`, then `toHaveBeenCalledExactlyOnceWith(...args)` with the args commander
really parses (`{ yes: false, format: 'yaml' }`, not a hand-written shape). Mutation
check: swap one `migrate('up')` for `'latest'` → exactly one row fails.
