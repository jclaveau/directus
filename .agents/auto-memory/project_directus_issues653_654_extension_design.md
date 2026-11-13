---
name: project_directus_issues653_654_extension_design
description: Issues #653 (extensions ship migrations) and #654 (coverage dump on demand, per extension) — design points proposed/settled, drop-extensions-folder idea, what is still awaiting jean
metadata:
  author: Jean Claveau
  type: project
---

Design round (2026-10-31), no code yet. Consumer specifics deliberately absent ([[feedback_directus_no_consumer_data_in_fork_memories]]).

**#654 coverage (SETTLED, issue updated, don't re-raise)**
- `POST /server/coverage`, no auth: gate is that the build is instrumented (`globalThis.__coverage__` defined), else 404. Only dev/test coverage builds have it.
- One process only; no bus broadcast to workers (every coverage run is single process). Doc the route as such.
- Per extension: manifest `"coverage": "<dir>"` relative to package; dump splits `__coverage__` keys by owning extension via `realpath(ext.path)` prefix (pnpm workspace deps are symlinks). Core files + ownerless files → `COVERAGE_DIR`, else a warning naming the count (no silent drop).
- One file per process, overwritten: `cov-<pid>-<startHrtime>.json` (a new file per dump would double hit counts). No periodic flush: `COVERAGE_FLUSH_INTERVAL` was built then DROPPED on review (2026-10-31, 3af2be72ac) — no run needs a crashed server's coverage (blackbox stops servers with SIGTERM → shutdown dump; its SIGKILL is a timeout that fails the test; consumers POST while the server is up). Do not re-add.
- Trap: old extension-based dumper + core dump on same dir → doubled hit counts.

**#653 migrations from extensions (OPEN, awaiting jean)**
- Findings: `cli/load-extensions.ts:16` skips extensions while migrations outstanding, and `directus_extensions` only exists after core migrations → runner must discover from manifests (`getExtensions()`), import a separate migrations module, never the hook entry.
- Health (`outstandingMigrations()`, database/index.ts:315, reads `EXTENSIONS_PATH/migrations`) and runner (`MIGRATIONS_PATH`) read different folders → one shared `listMigrations()`.
- `up()` uses global string order → needs next-pending-in-run-order for namespaced versions (`ext:0001A`).
- Bundle entries have no `sandbox` option; refuse sandboxed extensions declaring migrations.
- Proposed: manifest `migrations: {source, path}` → one compiled module, array order = order; run order core → extensions A→Z; orphan applied versions warn on latest, throw on down; new `migrate:status`.
- Awaiting jean: (1) `phase: 'after-schema'` vs extensions own tables, (2) `replaces:` to adopt bare consumer versions, (3) where path-mismatch fix lands, (4) post to #653?

**Idea floated, not yet ruled:** drop `EXTENSIONS_PATH`, `.registry` source, `EXTENSIONS_LOCATION` sync; load extensions only as pnpm deps (boot fails naming the var if set). Separate issue/PR landing before #653. Jean asked the question; I recommended yes and asked whether to open the issue.

**Why:** a fresh session otherwise redoes the code reading and the coverage-ownership reasoning.
**How to apply:** continue from the awaiting list; don't reopen the settled #654 points.

**Status 2026-10-31:** #654 implemented and PR #655 opened (jclaveau/directus#655): new dump module split by owning extension, `POST /server/coverage`, `COVERAGE_FLUSH_INTERVAL`, unit tests (split, symlinked path, overwrite + pid-reuse, serialized dumps, flush timer), Gherkin blackbox scenario with a temp fixture extension (timeout set on the scenario, not the step). Style gate left only warnings. `/pr-autoreview` on #655 was started; its outcome is below.

**#655 review outcome (2026-10-31):** CI green on 51b9b1437c. Two CI-only reds fixed:
- `packages/env` test `declared-types-vs-guessed.test.ts` pins every default whose declared type differs from the guessed one (`'0'` string vs number) → a new string-typed numeric-looking env default must be added there too.
- bb `written` order: core dir comes FIRST (core keys enter `__coverage__` at module load, extension key after) → assert core then extension.
- CodeRabbit is disabled on this repo (<10 stars): no bot re-review to wait for.

Jean's rulings (settled, don't re-raise): missing covered-extension path → skip + warn, files fall to COVERAGE_DIR (A); `coverage` may point outside the package (B, allowed); uncovered package nested in a covered one → keep, doc note only (B); refuse `coverage` on app-only types via schema superRefine on `ExtensionOptions` (A). Tests pushed first (red), fixes after.

Next, jean-asked: add `dist-release` for the PR branch, then the consumer PR using the generated dist (`v11.10.1-feat/coverage-per-extension-dist`; the consumer bumps its pin to the dist branch).

**Status 2026-10-31 (later):** #3A/#6A fixes pushed as 958311c11e (tests red first in CI, right reasons: ENOENT realpath; missing schema refusal). `dist-release` label added on #655 (jean asked) → dist branch `v11.10.1-feat/coverage-per-extension-dist` built. Only red on #655: bb postgres shard 3 `cache-purge-fingerprint-index-race` (known flake, `expected 742 to be greater than 900`); rerun is its own ask, not done. Consumer PR opened against that dist (a consumer PR); it must repin to `v11.10.1-hhh-dev-dist` after #655 merges. The consumer's own CI did not run (Actions budget spent) — local gates + a real dump check only. Never merge either without a per-PR ask.

**Status 2026-10-31 (end):** consumer PR review: jean ruled 1A (no periodic flush on the consumer; POST + shutdown dump enough). #655 CodeRabbit (needs `@coderabbitai review`, repo <10 stars, 1 review/h) raised 2: tmpdir realpath in tests fixed (8e18abd0ae), "refuse absolute/`..` coverage path" declined (ruling 4B). CI green on 8e18abd0ae.
- jean's inline review on #655: route renamed `POST /server/coverage` → **`POST /server/dump-coverage`** (9a8a9d5b0f; name = what it does; chosen over `dump-extensions-coverage` because it also writes core files to `COVERAGE_DIR`). **The consumer PR must switch its coverage helper to `server/dump-coverage` in the same commit as its repin.**
- Test inputs: a config key and its value must not be the same string (`coverage: 'coverage'`); use a realistic value (`'coverage/.tmp/backend'`) so a key/value mixup cannot pass (0e89ecae74).
- OPEN for jean: keep or drop `COVERAGE_FLUSH_INTERVAL` (`startCoverageFlush`, 4 tests, env entries, boot check `app.ts:135`; jean asked "didn't we decide against this time dump?"; #654 point 5 had kept it opt-in).
- Two flakes hit #655 → one dedicated fix PR (agent, branch `v11.10.1-fix/fk-no-key-and-fingerprint-flakes`): see [[project_directus_blackbox_flakes]].

**DESIGN PIVOT 2026-10-31 (jean, supersedes the manifest `coverage` key and rulings 3A/4B/5B/6A above):** the goal of #655 is that the extension SDK PROVIDES the instrumentation, so the consumer drops `rolldown-plugin-istanbul` entirely (#654 point 1 "consumer brings its own istanbul plugin" was my wrong assumption). The switch lives in `extension.config.js` (build config, JS so it can compute `enabled: env.X`), NOT in the manifest.
- Shape (amended below, 2026-10-31): `coverage: true` | `{ enabled?, dir?, ...rolldown-plugin-istanbul options }` | `false`/absent = plain.
- `directus-extension build` instruments the API entry only (SDK depends on `rolldown-plugin-istanbul`); app-only extension with coverage on → build fails; `NODE_ENV=production` + coverage on → build fails; instrumented bundle also throws on load in production.
- The instrumented bundle registers `{sourceRoot, coverageDir}` on a global; server `dump-coverage.ts` routes `__coverage__` keys by it. Manifest key, Zod rule, `Extension` field, `get-extensions.ts` plumbing, realpath/vanished-extension handling all REMOVED. No server-side production check: jean confirmed ("this would be a mistake from the developer") — not an open point.
- Consumer keeps nyc (Vitest `--coverage` reporter merges backend+frontend); SDK only removes instrumenting.
**Why:** jean: "off extension should just not be instrumented at all"; "forbid instrumentation in production for safety". A key that is both switch and location is two meanings, see [[feedback_one_meaning_per_config_value]].
**How to apply:** build run by a background agent (no report at handoff). Rewrite #654/#655 bodies to match. Never merge. #656 (flakes PR) green except known `common/assets/concurrency` flake #367; second rerun needs jean's go.

**Review round 2026-10-31 (jean):** route renamed `POST /server/coverage` → `POST /server/dump-coverage` (9a8a9d5b0f; `dump-` not `dump-extensions-` because it also writes core files to `COVERAGE_DIR`). The consumer's merger must POST the new path when it repins. Test fixtures avoid `coverage: 'coverage'` (key == value read as a mistake).

**Implemented 2026-10-31 (58da34257e on #655; #654/#655 bodies rewritten, thread 4433472033 answered).** jean's amendment, settled:
- Object form passes through ALL plugin options: `{ enabled?, dir?, include?, exclude?, instrumenterConfig?, instrumenter? }`. `dir` optional, default `coverage/backend` (the plugin has no output dir; include/exclude select sources, `dir` is where the server dumps).
- SDK defaults: include `<realpath pkg>/**`, exclude `<pkg>/node_modules/**` + `**/*.d.ts`, instrumenterConfig TS-capable (parserPlugins incl. `typescript`). User include/exclude REPLACE the defaults (relative globs anchored at the package real path); user instrumenterConfig shallow-merged over the defaults.
- Build refusals, full messages pinned in `instrument-coverage.test.ts`: app-only type; NODE_ENV=production; `instrumenterConfig.coverageVariable` ≠ `__coverage__`.
- Code: `packages/extensions-sdk/src/cli/commands/helpers/instrument-coverage.ts` (resolveCoverageTarget, banner, dynamic import of the plugin), option types in `src/cli/istanbul-options.ts` (no upstream types), banner on every node chunk (preserveModules), registry `globalThis.__extensionCoverageDirs`, read by `readExtensionCoverageDirs` in `api/src/utils/dump-coverage.ts`.
- Not covered: sandboxed extensions (isolated-vm, no shared global). The SDK now depends on the catalog's git URL of the plugin.

**Review outcome 2026-11-01 (a7224ac774, CI green 86 pass/2 skip; tests-first commit 8f2e62792c was red for the right reasons):** fixed 4 bugs: default `include` limited to script extensions (a `package.json` import broke the plugin's parse); sourceRoot glob-escaped (`(`/`{` in the path instrumented nothing); banner registry: latest `dir` replaces the old entry; server groups dumps by `path.resolve(dir)`. Documented: user `parserPlugins` replace the defaults (typescript included). Rejected (don't re-raise): 404 naming `/dump-coverage` (upstream routers do the same); no auth outside production (jean: no server backstop). Test commit 8f2e62792c carries a wrong message (stale temp file under noclobber); the force-push to reword was refused by permissions, so reword at squash.
- OPEN, awaiting jean (I recommend yes on all): A publish the plugin fork to npm and use via `catalog:` (CodeRabbit agrees; it's a git dep of the SDK now); B log + still emit `server.stop` when the shutdown dump fails; C refuse `include` outside the package; D add `decorators-legacy` to default parserPlugins (NOT `jsx`: breaks `<T>x` casts); E refuse `coverageGlobalScope`/`coverageGlobalScopeFunc` like `coverageVariable`; F refuse `dir: ''` and non-array/string `include`.
- Untested edges: hybrid/bundle app output uninstrumented, preserveModules banner per chunk, cjs output (reviewer read the code, found nothing).

**Review status 2026-11-01 (earlier):** CI green on 58da34257e. `/pr-autoreview 655` started (2 review agents); CodeRabbit triggered by hand on jean ask (repo <10 stars, no auto review; plan = 1 review/hour). Findings pending, nothing pushed by review yet.

**Rulings 2026-11-01 on A–F (jean, SETTLED, supersede the OPEN list above):**
- A keep the git URL of the plugin fork in the catalog (as forked `knex`); no npm publish until #302 resumes. Cost to know: a consumer installing the SDK from npm gets the git URL and needs its own `allowBuilds` line (my reading of pnpm, untried).
- B dropped: coverage only matters once the server no longer crashes.
- C GO, route by import tree, not folder: the banner is a function of the chunk (rolldown `moduleIds`) and lists `{coverageDir, sourceFiles}`; the server matches `__coverage__` keys by exact path. An `include` outside the package then lands in the right dir; the nested-package "deepest first" sort goes.
- D add `decorators-legacy` to default parserPlugins (not `jsx`). E refuse `coverageGlobalScope`/`coverageGlobalScopeFunc` like `coverageVariable`.
- F refuse `dir: ''` only (`'.'` resolves to the root too, jean accepted the asymmetry); keep type checks on `include`/`exclude`.
- Flow: tests commit 409fb13c24 (14 new tests, all red for the right reasons in CI), fix f0caeccc3d, PR body updated. CI on f0caeccc3d pending at handoff. CodeRabbit thread on A answered.

**Rulings 2026-11-01 (later, SETTLED) on `POST /server/dump-coverage` (#655):**
- Error code: `ROUTE_NOT_FOUND` (404) when `NODE_ENV` is `production` OR unset/empty (`|| 'production'`); any other `NODE_ENV` answers `NOT_INSTRUMENTED` so a dev sees the cause. Prod must not reveal the route; 501/409 rejected (they advertise it). Status code stays the contract, only the error code varies ([[feedback_api_status_code_is_contract]]). Fix landed after red-test commit 8d2dadbc38; CI green on 22baeed6b7.
- The consumer client must check `res.ok` and throw with the body's error code (fetch only throws on network errors).
- Accepted, do NOT re-raise: no periodic dump (POST + graceful shutdown only; SIGKILL/OOM loses the dump); route needs no auth (exists only on instrumented builds).
- Review findings of 22baeed6b7 open at handoff: one failing target write stops the later targets (fix: isolate per target); sandboxed (isolated-vm) extension + `coverage: true` throws `process is not defined` from the banner (fix: refuse when sandboxed, thread `sandboxed` to the coverage call sites build.ts:340/411/502); untested: preserveModules banner spread, `mode === 'node'` guard on hybrid app bundle, glob escape `*?!+@|`, `isCoverageObject` non-boolean `enabled`. Red tests for the first and the `NODE_ENV=''` case are on 6e468f5192, fixes uncommitted until CI shows red.

**Rulings 2026-11-01 (latest, SETTLED) on #655 autoreview of 22baeed6b7:**
- Fixed + pushed a090dd29 (per-target write isolation, `NODE_ENV=''` is prod); CI green on d3e4e2e3.
- Sandboxed extension + `coverage: true`: the reviewer's "process is not defined" was WRONG (`manager.ts:580` injects `process.env.NODE_ENV` into the isolate, upstream #25180). Real gap: the isolate has its own `globalThis`, so `__coverage__` stays inside it and `dumpCoverage()` never sees it. Jean chose B (NOT a build refusal): the server tracks each instrumented sandbox, reads its coverage at dump time, keeps a last snapshot on unload.
- Git-pinned `rolldown-plugin-istanbul` in the published SDK: keep, parked. Issue https://github.com/jclaveau/rolldown-plugin-istanbul/issues/2 (issues had to be enabled on that repo); comment above the catalog entry in `pnpm-workspace.yaml` points to it.
- Jean asked to fill ALL test gaps (preserveModules+coverage, app-bundle no-instrumentation guard, hybrid coverage, glob escapes, non-boolean `enabled`), each shown red in CI with its guard removed (one commit with guards off, then a commit restoring them), then `/pr-autoreview 655` again.
- Still open, unanswered: api #2 (dump chain recovery after a rejected dump untested), #3 (shutdown dump untested; a dump error skips `server.stop`, predates PR), #4 (unauth route returns absolute dirs; recommend keep).
- Lesson: verify a subagent's claim against the code before ranking it (`[[feedback_verify_before_asserting]]`) — a 🔴 downgraded to 🟡 here.

**6B + test gaps landed 2026-11-01 (#655):** red bf3ecb22 → red2 a501da28 → green 46d8be57. Red proved: manager test `Isolate is disposed` (release mutation), recovery/two-at-once (pendingDump chain), sandbox-recorded (`isCoverageInstrumented`), starts-over (`s:6` vs `s:1`, hash guard). Gotcha: the first hybrid-build test PASSED with the app-side plugin guard removed (vacuous), so red2 reworked it until `app.js` showed `__coverage__` without the guard — a gap test is not proven until it fails with its guard off. Monitors on a superseded head end with a cancelled app job: expected, not a finding. CodeRabbit check "skipped" on a push (needs a manual `@coderabbitai review`; only on jean's ask). Second `/pr-autoreview 655` started on 46d8be57; open: api #3, #4; no bundle-level coverage build test (only hybrid).
