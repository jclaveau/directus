---
name: reference_blackbox_coverage_exit0_teardown
description: blackbox CI with COVERAGE_DIR crashes at teardown — terminus graceful shutdown exits servers with code 0, but upstream setup.ts throws on any non-null exit code
metadata:
  type: reference
---

Blackbox tests (`Blackbox Tests / common` job, #110/#104 — the labeled PRs that run blackbox) fail **after** all tests pass (e.g. 54/54 green, "Tests complete!"), with an uncaught throw at teardown:
```
tests/blackbox/setup/setup.ts:93
  throw new Error(`Directus-sqlite3-no-cache server failed (0): `)
Node.js v22.x   <- process crashes, job red
```

Root cause: upstream `setup.ts` server exit handlers throw on `if (code !== null)` — they expect servers to be killed by **signal** (exit code `null`) at teardown (`server.kill()` = SIGTERM). Directus uses `@godaddy/terminus` (`createTerminus`, signals SIGINT/SIGTERM/SIGHUP) for graceful shutdown. The fork's coverage feature (#190 blackbox-coverage) added `await dumpCoverage()` to `onShutdown` in `api/src/server.ts`; on the `COVERAGE_DIR` CI path this makes the server complete graceful shutdown and exit with code **0** instead of dying by signal → `code !== null` is true → throw → crash. Pure-signal path (no coverage) exits `null`, so it only bites the coverage run. `setup.ts` is byte-identical to upstream (fork didn't touch it).

Fix (on the coverage feature branch `v11.10.1-feat/blackbox-coverage`, both the main + no-cache `server.on('exit')` handlers): treat clean exit as success —
```ts
if (code !== null && code !== 0)  // code 0 = graceful terminus shutdown at teardown; only non-zero is a real crash
  throw new Error(...);
```
Directus only exits 0 via terminus on SIGTERM (= teardown), so this doesn't mask mid-test crashes (those are non-zero or signal). See [[reference_rolldown_110_define_moved]] (same chain CI-fix session).
