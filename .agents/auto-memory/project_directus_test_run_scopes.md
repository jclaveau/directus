---
name: project_directus_test_run_scopes
description: how to run the Scalabus suites locally — root `pnpm test` skips api and app, the app run OOM-crashes (shard it), `--changed origin/v11.10.1-hhh-dev` is the fast loop, and which failures are pre-existing rather than yours
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
- **The fast loop is `cd api && pnpm vitest run --changed origin/v11.10.1-hhh-dev`**
  — 13s against 181s for the full package, and it selects dependent tests through
  the module graph, which a file-scoped run misses. Use it after every edit; keep
  one full `vitest run 2>&1 | tee <log>` before pushing. See
  [[feedback_test_run_ladder]].
- **api timeouts under load are usually flakes, but check for a real one first.**
  A loaded full run failed `items.test.ts`, `stall.test.ts` and
  `get-database-for-accountability.test.ts` with `Test timed out in 5000ms`; those
  pass in isolation. But `items.test.ts > updateMany > … bare empty relational
  array` was NOT a flake — it took 3334ms on an idle box because it was the first
  test to trigger PayloadService's lazy `get-service.js` import, and CI load tipped
  it past 5s. Fixed by loading that graph in `beforeAll` with a 120s budget
  (10s is not enough under contention). So: re-run isolated, and if it is still
  seconds-slow while its siblings are milliseconds, it is a real cost, not luck.
- **Two api failures are pre-existing on this box**, not yours:
  `get-address.test.ts > … unix socket` (fails identically on the base branch,
  passes in CI) and `get-database-for-accountability.test.ts` (5s timeout under
  load only).

**Why:** I reported "full suite green" off the root script while api/app had not
run at all, then read a crashed app run as a failure. Both are silent.

**How to apply:** api + app explicitly, app sharded; any 5s-timeout failure gets
re-run isolated before it goes in a report. See [[project_directus_blackbox_sharding]]
for the CI-side equivalent.
