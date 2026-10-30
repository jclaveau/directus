---
name: project_directus_autoscaler_process_ram
description: The autoscaler process costs ~230 MB resident because createCli() eagerly loads the whole api and both @directus/env barrels — measured breakdown (fork #489)
metadata:
  author: Jean Claveau
  type: project
---

Since #456 the autoscaler is a process of its own (`directus autoscale`,
`instances: 1`, `exec_mode: fork`), where pm2-autoscale was a pm2 *module* living
in the God daemon and costing no second process. jean flagged the ~230 MB
steady-state RSS as the one real regression. Filed as fork **#489**.

**Measured** (node 22.22, a consumer's installed `@directus/api`, RSS after one
dynamic import into an otherwise empty process):

| | RSS |
| --- | --- |
| node baseline | 42 MB |
| `import('@directus/api/dist/cli/index.js')` | **220 MB** |
| commander + pm2 + ioredis + pino + `@directus/env` | **108 MB** |

The second row is all the loop reaches for, and `loadExtensions()` has not run in
either. Inside the 108 MB floor, `@directus/env` is 40 MB / 395 ms on its own:
`lodash-es` +20 MB/373 ms, `@directus/utils` +27 MB/278 ms, `dotenv` +1 MB,
`@directus/constants` +0 — the barrel shape of
[[project_directus_barrel_import_shapes]].

**Cause:** `api/src/cli/index.ts` makes exactly one import lazy (the autoscale
module, so pm2 stays out of the workers) and takes the rest eagerly — including
`startServer` from `../server.js`, which is express + knex + every controller and
service — plus 12 command modules. `loadExtensions()` is a *call* inside
`createCli()` that runs before a command is chosen, so the autoscaler also loads
every api-side extension the deployment ships.

The same command graph is carried by every api worker, which only ever runs
`start` — so this is the "every CLI command" term of
[[project_directus_eager_module_imports]], multiplied by the pool.

Third, free lever: the `autoscaler` app in the consumer's
ecosystem config declares **no `node_args`**, so it runs on V8
defaults while the api app gets `--max-semi-space-size=2`
([[project_directus_ram_node_flags]]).

Reproduce without a container:
```js
const mb = (n) => Math.round(n / 1048576);
const before = process.memoryUsage().rss;
await import('<abs path>/@directus/api/dist/cli/index.js');
console.log(mb(before), '->', mb(process.memoryUsage().rss));
```
Bare specifiers resolve from the *script's* directory — use `createRequire` with
a base inside the package, or absolute paths.

**PR #492** (`v11.10.1-perf/cli-lazy-commands`) does both levers: every command
imports its module from its own action (eslint-pinned, mutation-tested), and
`loadExtensions()` runs only when the first non-flag argument names no built-in
command — the one shape that can have come from an extension's `cli.before`
hook. `start` registers extensions for itself from `app.ts`. The barrel half is
[[project_directus_utils_barrel_cost]]. Bench on the branch: startup 1264 ms,
-66 ms vs baseline.

A worktree **cannot** measure the api dist: `api/node_modules` symlinks to the
main checkout, so an unbundled api build writes `dist/directus-cms-2/node_modules/…`
paths and resolves `@directus/*` from the other branch. Farm
`packages/<pkg>/node_modules` by hand to measure a single package
([[project_directus_worktree_shared_node_modules]]).

**Deep review (2026-09-15) found the CLI-half claim above did not hold on
`4d71fa4f0a`:** `load-extensions.js` stayed a *static* import in
`api/src/cli/index.ts` — the `needsExtensions` gate skipped only the *call*, so
the process still evaluated the extension manager's graph (198 of a measured
216 MB), and `emitter.js` (119 MB, the database graph) was imported for two
`emitInit` calls nothing listens to. **Fixed in `d8b5d7dfc7`**: both are dynamic
imports inside the gate, hooks emitted only on the loading branch; eslint bans
`./load-extensions.js`, `../emitter.js` (type imports allowed), `../processes/**`;
`index.graph.test.ts` proves by mock-factory side effects which modules a
built-in command reaches; `BUILT_IN_COMMANDS` is pinned equal to
`program.commands`.

**Measured on the branch's deploy bundle** (`056a5ed206`, node 22.22, RSS after
gc, fresh process): program for `autoscale` **53 MB**, + `entry-guard.js` +
`processes/autoscale/index.js` **115–117 MB** (noise band 115–126 across single
runs, so the bench takes the smallest of three). A static import put back →
191 MB.

**`tests/perf/resident.perf.test.ts`** (`74d18ac9d7`) budgets them: program
70 MB, autoscaler 150 MB (runner measured 123-124 where the laptop had
115-117); runs in `bench.yml` after Check with a
`Bench / resident` commit status carrying numbers + verdict — wiring active
only once merged: a `workflow_run` job runs the TRUNK's copy of bench.yml, so
on a PR the resident table lives in the artifact only. Print the RSS as a
*string* in the child: `FORCE_COLOR` from pnpm wraps a logged number in colour
codes and `Number()` reads NaN, which passes a `>` budget check silently.

**What the autoscaler still holds (62 MB past the program) is not the CLI's**
(traced with a `registerHooks` load tracer: 156 api modules, 75 under
`database/`). Layers: logger/index.js = 99 MB alone (46 above the program:
env 19, `@directus/utils` barrel 31, pino trio ~14, lodash-es-used ~13,
overlapping); the metrics door adds ~15 MB: `entry-guard.js` →
`report-unhandled-rejection.js` → `useMetrics()` → `create-metrics.ts` →
`database/index.js` + `cache.js` + storage + redis + permissions — knex,
`@directus/schema`, 56 dialect helpers, 17 run-ast files, for a counter.
`processes/lib/shared-settings.ts` reads via bus + env, so without that door
the autoscaler holds NO database module. Barrel importers left in the graph
after closing it: `logger/index.ts`, `redact-headers.ts`, `redact-query.ts`
(`REDACTED_TEXT` — in `shared/get-redacted-string.ts`, zero imports, not yet
in `/values`), `get-config-from-env.ts` (`toArray`), `shared-settings.ts`
(`parseJSON`). Next levers, metrics door first (removes 16 of 21 barrel
importers), each its own PR; together ~115 → ~70 MB; lower the resident
budget once they land. An earlier "80 MB for metrics" figure was the module
alone minus bare node, i.e. it counted the logger twice.

**Measuring a branch's dist from a worktree works** if every `packages/*`,
`sdk`, `app`, `directus` and `tests/perf` `node_modules` is symlinked to the
main tree's, then `pnpm --filter "@directus/api..." --filter "!@directus/app"
--filter "!directus" run build` and `pnpm --filter directus deploy --legacy
--prod dist`: the bundle copies the WORKTREE's `packages/*` (its own env with
`/values`), so it is the branch's truth. `tests/perf` has no `node_modules`
anywhere — link it to `api/node_modules` for vitest.

**Lever 2 landed (`cc61a02803`, same PR):** the 22 importers (21 api + `@directus/memory`'s
`serialize.ts`) read from `/values`, which now also exports `compress`,
`getFilterOperatorsForType`, `getFunctionsForType`, `getOutputTypeForFunction`,
`getRedactedString`/`REDACTED_TEXT`, `getRelation`, `getSimpleHash`, `isObject`.
Autoscaler **118 → 111 MB** in one run (the bundle costs 31 alone; date-fns and
lodash-es were already in the graph through the api's gathered imports, so only
joi, micromustache and system-data left). Pinned by an eslint block over the
floor (entry, logger, metrics/, processes/, packages/memory) and
`processes/autoscale/index.graph.test.ts` (recording `@directus/utils` mock
factory that returns the original; 30 s timeout because it loads the real graph).
What is left above the program (~58 MB) is the logger's layer + the metrics door:
knex + CJS lodash (252 modules), prom-client + `@opentelemetry/api`, cache,
storage, redis. The autoscaler serves no `/metrics` and runs no `generate()`,
and the pm2 sync only targets apps named `directus`, so its counter is unreadable
in every configuration — metrics are dead weight there.

**Metrics door closed (`89e7f6ffad`, same PR):** `metrics/lib/instance.ts` holds
`_cache` (imports nothing); `report-unhandled-rejection.ts` reads
`metrics.metrics?.getUnhandledRejectionMetric().inc()` — counts only where the
process already created a registry (worker: at `schedules/metrics.ts` load;
autoscaler: never). Trade-off accepted by jean: a worker's CLI-build-time
rejection (dead-Redis extension subscribe) is logged, not counted. Autoscaler
**111-118 → 80-86 MB** (four laptop runs each), budget 150 → **110** (red at 115
with the previous bundle as head). eslint regex pin `^\.\./metrics/(?!lib/instance\.js$)`
on the guard (gitignore-style `!` negation in `group` did NOT work for `../`
paths); floor block exempts `**/*.test.ts` (tests import `oneLine` from the
barrel). Left in the graph: logger layer + `/node` (fs-extra 13, js-yaml 9) +
`@directus/memory`'s rate-limiter-flexible.

**PR #492 merged as `c970706736`** (review-fix commit `b1aac32edd`, coverage-gap
commit `1218563f7d` — see [[reference_codecov_patch_coverage]] for the barrel
load-witness test that closed it).
