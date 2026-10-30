---
name: project_directus_pr454_node_flags_report
description: PR #454 (processes admin page reports each worker's Node flags) — rebased onto trunk post-#491, NODE_OPTIONS never reaches process.execArgv (only node_args does), replica-crash guard, merged
metadata:
  author: Jean Claveau
  type: project
---

Fork PR [jclaveau/directus#454](https://github.com/jclaveau/directus/pull/454) adds
`execArgv` (the Node flags a worker actually booted with) to the processes admin page's
per-process report. Went stale on trunk (last touched 2026-09-08) after #456/#467/#491
reshaped `report-processes.ts`/`types/processes.ts`/`processes.vue` — rebased onto
`9cdfbde9e2` (post-#491) as `ebda67cf7e`, one mechanical conflict (both sides appended a
test to `report-processes.test.ts`, kept both).

**Settled fact: `NODE_OPTIONS` never reaches `process.execArgv`.** Verified directly
(`NODE_OPTIONS=--max-semi-space-size=3 node -e '...'` → `execArgv` empty). Only pm2's
`node_args` (which becomes real `argv` flags at fork) lands there. The PR's own type doc,
test comments and body originally claimed `NODE_OPTIONS` was covered — reworded to "what
pm2's `node_args` hands Node"; `NODE_OPTIONS` still reaches the report through the
existing env half. Prod is unaffected either way: a prod consumer sets its flag
(`--max-semi-space-size=2`) via `node_args` in its ecosystem config, not
`NODE_OPTIONS`.

**Had no bb witness for the pm2 route at all** — added one arm to
`autoscale-processes.test.ts` (autoscaler already runs under real pm2 there): declare it
with `node_args: ['--max-semi-space-size=2']`, assert `runtime.execArgv` contains it next
to `nodeVersion`; a plain `processes` start asserts `[]`.

**Deep review found one P2:** the admin page reads `node.runtime.execArgv.length`
unguarded (`processes.vue:741`). Replicas are gathered by service name over shared Redis,
so during a consumer deploy (its services switch over minutes apart) the page can list an
OLD build's report that predates the `execArgv` field entirely → `undefined.length` →
render error → the whole processes page blanks for that window, for every future field
this report grows the same way (every earlier addition — `autoscale`, `nodeId`, `env` —
was tolerated absent). Fixed at the collector: `runtimeOf()` in `collect-processes.ts`
fills `execArgv: []` when a report carries none (both the listed and unlisted branch),
keeping the type required rather than optional on the page. Witness in
`collect-processes.test.ts`, mutant (fill dropped) killed. Also `.runtime { flex-wrap:
wrap }` (a long `node_args` list — a consumer's profiling flags run three at once —
would squeeze or overflow the row; no jsdom witness, layout only).

**Settled, not changed:** Node flags carry no credentials (worst case is a path like
`--cpu-prof-dir`) and the env half already shows unredacted paths to the same admin —
left unredacted, the PR body's open "say so and I will wire it" line on redaction
dropped as answered.

Merged `d38af828d5`; `-dist` rebuilt to `0bf3a4b096` (pinned manifests identical, SHA
substitution only); the consumer's pin bumped. One shard-1 bb failure on the
rebased head (`cache-cascade-delete.test.ts` seed relation-create race) did not recur on
the next push — flake, not #454's diff, same shape as issue #308's seed-retry class.
