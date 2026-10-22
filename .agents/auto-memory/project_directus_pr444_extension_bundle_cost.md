---
name: project_directus_pr444_extension_bundle_cost
description: PR #444 extension-sdk bundle cost — P1-P4 measured levers on the planner's real extensions, settled verdicts, don't re-raise
metadata:
  author: Jean Claveau
  type: project
---

`packages/extensions-sdk` build (`build.ts`) inlines everything into an api-extension
bundle except `directus`/`directus:api` (no `external` escape hatch existed). PR #444
(`v11.10.1-perf/extension-bundle-cost` → hhh-dev) ships P1+P2+P4, P3 opt-in only. All
numbers measured on the planner's real 8 extensions, one process, arms interleaved.

- **P1** — `fresh: true` only on reload, not initial load (`api/src/extensions/manager.ts`):
  789→496 ms/worker (−293ms, ~9.4s at 32 workers). Root cause: `import-file-url.ts`'s
  `?t=${Date.now()}` busts Node's compile-cache key every boot, so `?t=` (789ms) is
  WORSE than no cache at all (623ms) — enabled, missed, rewritten every time.
- **P2** — `@directus/extensions`: `tsdown --unbundle` + `sideEffects: false`. Isolated
  hook probe 125,629→304B; both changes required, neither alone moves a byte. On the
  planner: only −7.4KB (domain's `extensions-exports.ts` re-exports composables/themes
  as VALUES on purpose → blocks treeshake; the other 7 extensions never imported the SDK
  barrel). `sideEffects:false` on `@directus/types` first measured as 0-benefit — false,
  the A/B never varied (a stash mishap left both arms identical); re-measured properly:
  264,224→513B, 140→3 modules. Kept: real win for a normal extension, near-nil for this
  fleet.
- **P3** — `--external` CLI flag + `config.external` (new `Config` field, opt-in only,
  never default): knex+composables/themes external → 13.63MB→5.05MB (−63%) but
  **throws at runtime** (`Named export 'Knex' not found`, CJS module) and wouldn't save
  time anyway (api dist bundles its own knex; external one loads a second copy). Early
  runs looked "identical" because the build was silently failing to apply `external` —
  re-measure the artifact size/content, not just the timing, before trusting a null
  result. Precisely located the planner's real waste for #442: one file imports `Knex`
  as a value not `import type` (5.36MB for a type), and `extensions-exports.ts`
  re-exports app composables from the API entry (3.22MB that belongs in `app.js`).
- **P4** — build-time report: size + module count always; warns only when an API entry
  pulls app-only packages (vue/vue-i18n/pinia/themes/composables). Caught all 5 on the
  real build.

Rejected/deferred, don't re-raise: P5 (auto-externalize declared deps) — a `local`
extension has no `node_modules`, can't be the default. P6 (`codeSplitting`) — loader
expects one file, deferred.

Test gotcha: `extensions-sdk`'s `create` scaffold npm-installs the *published* SDK, so
the stock build-test measures the registry, not this branch — point it at the workspace
(`install: false` + a symlink) or it silently validates nothing.

**Why:** #2 lever (after #440's boot-cost work) toward faster PM2 autoscale reactivity.

**How to apply:** remaining planner-side fixes (import type Knex, move composables
re-export to app.js) belong to issue #442, not this repo. `tmp/sdk-probe/` is the P1-P4
harness — worth promoting to a bundle-size regression test in `packages/extensions-sdk`
so P2 can't silently regress.

**MERGED** (`43fd20ea35` on hhh-dev). Repo's own bench finally saw the path — it boots
extensions-free by default, so it originally read +30ms of noise; patched to load
`PERF_EXTENSIONS` generated hooks, then confirmed **−165ms/worker vs baseline** (later
−169ms on a second run) — first time this repo's bench proved P1's win itself. Two deep
review rounds surfaced and fixed, all settled/don't re-raise: (1) the two P2 size
assertions passed on an *unresolved* bundle (dist absent → 241B externalized import
still under the 5000B/no-ZodError bar) — fix is asserting the specifier is gone, not
just a byte ceiling; (2) P1's lifecycle had zero test coverage — added
`manager.test.ts` covering all 4 import sites (hook/endpoint/operation/bundle), mutation
verified; (3) `--external` silently applied to the app-side build too (same list handed
to both `mode: 'browser'` and node) — restricted to node only; (4) size report read
`0.00 MB` for real extension sizes — switched to a KB/MB scale; (5) `APP_ONLY_PACKAGES`
now derives from `APP_SHARED_DEPS` instead of duplicating it by hand; (6) bench generator
was O(n²) (4.5s/extension via repeated `.join('\n').length`) — fixed to running-length,
5ms/extension, byte-identical; (7) bench read child stdout after `'exit'` not `'close'`,
so the load-assertion could see a truncated buffer; (8) `APP_SHARED_DEPS` was handed to
rolldown **by reference** — `manager.ts` imports the same module-level array, so an
in-place bundler mutation would have corrupted the loader's copy too; one more spread
fixed it. Coverage closed to ~99% with a dedicated bundle-extension build test (the one
shape — two entrypoints, generated entry — nothing had built before).
