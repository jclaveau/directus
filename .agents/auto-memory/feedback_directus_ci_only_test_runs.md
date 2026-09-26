---
name: feedback_directus_ci_only_test_runs
description: On this repo run every test in CI and loop on the run — unit, typecheck and blackbox alike; no local vitest or tsc gate.
metadata:
  author: Jean Claveau
  type: feedback
---

**Run the tests in CI, always, and loop on the CI run — never on a local run.** Every
layer: the unit suites, the type tests, the blackbox suite. Said after a window in which
I ran `tsc -p api --noEmit` and the full api vitest suite locally before each push.

**Why:** the runners are running it anyway on every push (`check.yml` fires on `push:`,
every branch), sharded three ways — `Unit Tests (api)`, `(app)`, `(rest)` — while locally
it is one 400s serial run on a machine that also has to keep working. And a local run of
this suite cannot even come back clean: `app.test.ts` needs a built `@directus/app`,
`get-address` trips on a stale `/tmp/server-test.sock`, `stall` on timing, the
`cli/commands/schema` pair on terminal width. Five files, 19 tests, all environmental —
so the local run's signal is "those five again", which is no signal at all.

Types are covered there too: `api/vitest.config.ts` sets `typecheck.enabled`, and CI's api
shard runs `vitest run --coverage`, so the `Type Errors` line is part of that job. A local
`tsc -p api --noEmit` adds nothing CI does not already fail on.

**How to apply:**
- Commit, push, and read the verdict off the run — mechanics in
  [[project_directus_blackbox_run_and_logs]], and loop with a poll job or
  `ScheduleWakeup` rather than a held-open turn.
- Judge on `Check` / `Style (changes)` / CodeQL. Never on the admin preview
  ([[feedback_directus_ci_watch_skip_preview]]).
- The blackbox layer was already CI-only ([[feedback_directus_bb_tests_in_ci]]); this
  extends the same rule to the unit and type layers, and retires that entry's "a local
  targeted `vitest` is still fine" exception.
- `npx eslint <files>` and `node scripts/lint-style-changes.mjs origin/<base>` stay local:
  they are seconds, they shape the commit rather than verify it, and the hooks already
  run eslint on every edit.
