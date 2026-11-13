---
name: project_directus_processes_autoscale_consolidation
description: Three independent pm2 clients (processes/, autoscale/, metrics/) plus an import cycle between processes/ and autoscale/ — consolidated under api/src/processes/{supervisor,autoscale}/, contract unchanged
metadata:
  author: Jean Claveau
  type: project
---

Settled and built 2026-09-10 on `v11.10.1-feat/processes-module`, branched off
PR #467's head (`e23ea155de`). **PR #472**, base `v11.10.1-feat/autoscale-config`
(stacked on #467) — **collapsed into #456 on 2026-09-10** (fast-forward, #472 and
#467 both merged; #456 is now the single PR into `hhh-dev`, 80 commits at
`d0a07d401c`). Four commits: `6c9730ee52` the supervisor gateway,
`11072df5bc` the move, `a014e399e7` the Redis-key rename, `d0a07d401c` the
coverage the move handed to the patch gate.

## What existed before the autoscaler (#467 added the third pm2 client)

`api/src/processes/` (landed by #349, hardened by #447) already owns pm2
**observation**: `supervisor-snapshot.ts` (`pm2.list`, `supervisorAvailable()`
probe — `PM2_HOME` alone lies on Backend, needs a numeric `pm_id` too),
`report-processes.ts`/`collect-processes.ts` (bus fan-in), `host-capacity.ts`
(cgroup-aware ceiling), `redact-env.ts`, `processes-config.ts`, route
`/utils/processes`. `api/src/metrics/lib/create-metrics.ts` has its own pm2
client (`list` + `sendDataToProcessId`). `api/src/autoscale/lib/pool.ts` is the
third.

`autoscale/` follows the *module* conventions (barrel + `lib/*` + colocated
tests, reload asked for over `useBus()` like the processes channels, autoscale
state rides the existing process report instead of a second collection path)
but not the *pm2-access* ones, because there were none — each of the three
rolled its own client.

## The five divergences found

1. **Three independent pm2 clients**, each `promisify(pm2.list.bind(pm2))`.
   Not cosmetic: pm2's `cpu` is a delta since the last lister
   ([[project_directus_pm2_cpu_delta_window]]), which is why `worker-cpu.ts`
   already had to stop trusting pm2 and read `/proc` over its own window — the
   workaround is in the tree, the shared client that would prevent needing it
   is not.
2. **`pm2_env` re-typed twice** — `SupervisedProcessEnv` (processes) and
   `DeclaredWorkerEnv` (autoscale), same justification comment in both ("pm2's
   typings stop at a documented subset"), overlapping fields, different
   strictness.
3. **The freeze hardening lives only in `autoscale/pool.ts`**
   ([[project_directus_autoscaler_supervisor_call_freeze]]'s 15s bound +
   serialized reconnect). `supervisor-snapshot.ts:69` and
   `create-metrics.ts:59,99` call `listApps()` bare — same daemon, same hazard,
   no bound.
4. **Host memory read two ways** — `autoscale/index.ts:237` uses raw
   `freemem()` for the legacy strategy's brake while `host-capacity.ts` exists
   and documents that `os.totalmem()` overstates under a container. On Railway
   this brake reads the host, not the cgroup.
5. **Naming scope leak** — `/utils/autoscale/supervisor` writes pm2 options and
   `/utils/autoscale/reload` replaces workers; neither is scaling. The app
   already disagrees with the backend: the panel lives in
   `app/src/modules/settings/routes/processes/`.

**The cycle that settles where the boundary should be drawn:**
`processes/lib/report-processes.ts` imports `autoscale/lib/state.js`, and
`autoscale/index.ts` imports `processes/index.js` (`initProcessReports`). A
cycle between sibling directories is the standard sign the split is in the
wrong place; merging makes both edges internal.

## Decision (jean: "ok go for src/api/processes/... and consolidate")

```
api/src/processes/
  index.ts        barrel — report/collect init only
  lib/             existing report side (collect, report, host-capacity, redact-env, config)
  supervisor/      the pm2 gateway: connect/reconnect/timeout, list, scale, reload,
                   one pm2_env typing, one supervisorAvailable()
  autoscale/       the loop: decide, pool-samples, worker-cpu, state,
                   resolve-config, shared-config, supervisor-shared-config, drill
```

`metrics/create-metrics.ts` also consumes `supervisor/`, so all three pm2
clients collapse to one and the 15s freeze bound covers all of them, not just
the autoscaler.

**Do NOT move the routes or the MCP tool names.** `/utils/autoscale*` is
published in the OAS and `SYSTEM_MCP_TOOLS` on live deployments (including
scalabus-dev) names the `autoscale`/`autoscale_drill` groups. Directory layout
and URL surface are independent — move the code, leave the contract. Whether
`/utils/autoscale/supervisor` and `/utils/autoscale/reload` should become
`/utils/processes/*` is a **separate**, deliberately deferred decision (a real
contract change).

**The lazy-import boundary this is meant to protect is already defeated
today**: `app.ts:75` statically imports `processes/index.js` →
`report-processes.ts` → `supervisor-snapshot.ts` → `import pm2 from 'pm2'`, so
pm2 is resident in every worker regardless of the autoscale flag or
`cli/index.ts`'s lazy import of `runAutoscaler`
([[project_directus_eager_module_imports]] — measured at only ~1.7 MB
heap/worker, so this is not a RAM argument, just a "the boundary already
leaks" one). Merging doesn't worsen it; it makes the one place to fix it
obvious. A merged `processes/index.ts` must still not re-export
`runAutoscaler`, or the CLI's deep lazy-import becomes pointless.

## What landed (two commits, one PR)

1. `processes/supervisor/lib/client.ts` — the only module that imports `'pm2'`.
   `supervisorAvailable`, `listSupervisedApps`, `scaleApp`, `reloadApp`,
   `sendToSupervisedProcess`, `connectToSupervisor`, `disconnectFromSupervisor`,
   all through `answeredInTime` (15s, single-flight reconnect).
   `processes/supervisor/lib/env.ts` holds `SupervisedProcessEnv`, the merged
   `pm2_env` typing (divergence 2), with the three fields a report shows kept at
   their narrow types so the snapshot needs no coercion. `pool.ts` is left with
   the reading only; its client-level tests moved to `client.test.ts`.
   The client binds `pm2.*` lazily **inside** each function rather than at
   module scope, so a test may mock `'pm2'` with only the calls it exercises —
   that is what keeps `supervisor-snapshot.test.ts`'s `{ list }` mock working.
2. `git mv api/src/autoscale → api/src/processes/autoscale`, imports rewritten
   in `app.ts`, `cli/index.ts`, `controllers/utils.ts`, `services/utils.ts`,
   `system-mcp/lib/tools.ts` and `processes/lib/report-processes.ts`.

3. Redis keys follow the module: `<ns>:config:pm2` →
   `<ns>:config:processes:autoscale`, `<ns>:config:pm2:supervisor` →
   `<ns>:config:processes:supervisor`. Only free while #467 is unmerged — see
   [[project_directus_pr467_autoscale_config_surface]] for why, and for what a
   post-merge rename would cost. The `PM2_AUTOSCALE_*` env names are a
   deployment contract and did NOT move.

4. The move re-charged every never-covered line of `pool.ts` and of the pm2
   calls lifted into `client.ts` to codecov's diff, so a behaviour-free
   refactor read 79.36% against a 95% target
   ([[project_directus_codecov_aggregate_patch_gate]]). `restarted()` had no
   test at all — the loop is its only caller and `index.test.ts` mocks it —
   and `readPool` had never been read with a launching or a warming worker.
   Both files now read 100%.

**Still open, deliberately out of scope:** divergence 4 (the legacy strategy's
raw `freemem()` brake vs `host-capacity.ts`), divergence 5 (whether the two
pm2-declaration routes rename to `/utils/processes/*` — a real contract change),
and `create-metrics.ts`'s `isPM2 = 'PM2_HOME' in process.env`, which is the
#447 false-positive shape rather than the gateway's honest probe.

Timing note: #467 was green and under review when this came up — a directory
move there would have rewritten every path in that diff and forced a fresh
blackbox run, so this consolidation is its own branch off #467's head, not
folded in.

Related: [[project_directus_pr467_autoscale_config_surface]],
[[project_directus_autoscaling_models]],
[[project_directus_autoscaler_supervisor_call_freeze]],
[[project_directus_pm2_cpu_delta_window]].
