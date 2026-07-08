---
name: project_directus_blackbox_coverage
description:
  How the fork captures blackbox/integration coverage — rolldown-plugin-istanbul instruments the tsdown api build, server
  dumps __coverage__ on shutdown, CI merges to lcov + uploads a `blackbox` codecov flag; needs tsdown, not tsc
metadata:
  type: project
---

PR #190 "v11.10.1-feat: blackbox/integration coverage…" adds integration coverage so controllers/auth-drivers
(integration-only, otherwise codecov-`ignore`d — see [[project_directus_codecov_flags]]) get real coverage.

## Mechanism (all gated on `COVERAGE_DIR`; off → prod ships clean)

- **`api/tsdown.config.ts`**: `rolldown-plugin-istanbul` plugin when `COVERAGE_DIR` set. istanbul-lib-instrument runs
  `@babel/parser` whose default plugins are JS-only → **must pass `instrumenterConfig.parserPlugins` incl `'typescript'`**
  (+ the istanbul defaults: asyncGenerators, classProperties, …) or it dies on the first type annotation. With
  `unbundle: true` coverage is keyed by SOURCE path (`src/controllers/server.ts`) → maps straight onto sources.
- **`api/src/server.ts`**: dump `globalThis.__coverage__` in the terminus `onShutdown` hook (awaited before exit);
  filenames `cov-<pid>-<hrtime>.json` so the many spawned blackbox servers don't collide. Blackbox kills with SIGTERM →
  terminus → onShutdown.
- **`tests/blackbox/merge-coverage.mjs`**: merge `cov-*.json` via `istanbul-lib-coverage`/`-report` → `lcov.info`.
  istanbul-lib-* are **CommonJS** → default-import + destructure (`import lib from 'x'; const {fn}=lib`), named ESM
  imports throw.
- **`.github/workflows/blackbox.yml`**: job-level `COVERAGE_DIR` (build instruments + spawned servers inherit via
  config.ts `...process.env`), then merge + `codecov -F blackbox`. See [[reference_reusable_workflow_codecov]] for the
  `secrets: inherit` + `-C head-sha` fixes that made the flag actually post.
- **`codecov.yaml`**: `blackbox` flag carryforward + report-only (label-gated, slow). The git dep needs
  `onlyBuiltDependencies: ['rolldown-plugin-istanbul@<full-url>']` (bare name rejected) for its `prepare` build script.

## Hard constraint

bb-coverage needs **tsdown/rolldown** (build-tsdown #115). The runtime feat stack (#98–110) is `tsc`-built on prepare →
**can't get bb-coverage until recomposed on top of build-tsdown.** So #190 is the only branch where controllers are
un-ignored AND covered (41.39% project / 80% patch). To drop the prepare-wide `ignore`, recompose with build-tsdown +
#190 BEFORE the runtime feats so they inherit instrumentation.
