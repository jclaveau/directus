---
name: project_directus_codecov_aggregate_patch_gate
description: The BLOCKING codecov check on this fork is the unflagged `codecov/patch` at a hard 95% — every per-package flag is informational; blackbox coverage feeds it but attributes coarsely, so bb-only code cannot clear the bar
metadata:
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
