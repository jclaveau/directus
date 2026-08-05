---
name: project_directus_test_run_scopes
description: root `pnpm test` silently skips api and app; the full app vitest run OOM-crashes on jean's box (shard it); api timeouts under load are flakes not regressions
metadata:
  type: project
---

Running the Scalabus suites locally, before claiming "all tests pass":

- **Root `pnpm test` does NOT run api or app.** `pnpm --recursive --filter
  '!tests-blackbox' test` reports ~24 `packages/*` + `sdk` and exits 0 — api and
  app never appear. Run them explicitly: `cd api && pnpm vitest run`,
  `cd app && pnpm vitest run`. Claiming green off the root script is claiming green
  on the packages only.
- **The full app run crashes on jean's box**, not fails: `ERR_IPC_CHANNEL_CLOSED` /
  `Error: Channel closed` from tinypool after ~60 of 136 files, with **no summary
  line**. Reproduces under `--maxWorkers=3` and `--pool=forks --singleFork`, so it
  is memory (box had ~1GB available), not a pool setting. **Fix: shard it** —
  `for i in 1 2 3 4; do pnpm vitest run --shard=$i/4; done` (34 files each, fresh
  process per shard).
- **api timeouts under load are flakes.** A loaded full run failed 5 tests
  (`items.test.ts`, `stall.test.ts`, `get-database-for-accountability.test.ts`)
  with `Test timed out in 5000ms`; all pass in isolation. Re-run the failing files
  alone before attributing anything to your diff.

**Why:** I reported "full suite green" off the root script while api/app had not
run at all, then read a crashed app run as a failure. Both are silent.

**How to apply:** api + app explicitly, app sharded; any 5s-timeout failure gets
re-run isolated before it goes in a report. See [[project_directus_blackbox_sharding]]
for the CI-side equivalent.
