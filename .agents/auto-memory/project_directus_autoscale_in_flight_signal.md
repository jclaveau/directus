---
name: project_directus_autoscale_in_flight_signal
description: How the autoscaler learns which worker is busy — pm2's own message channel, not the Redis bus — and how a release names its victim
metadata:
  type: project
---

Shipped on PR #456 (commit `275ea4ed0d`), closing fork issue #482.

## The transport, and why it is not the bus

Workers report how many requests they have open over **pm2's own channel**, not
`useBus()`. The autoscaler must keep scaling through a Redis outage, so a signal
it reads while choosing which worker to stop cannot vanish with Redis. pm2
re-emits a worker's `process.send({type: 'process:msg', data})` on the daemon's
bus, and that path *is* the supervisor — if it is down there is nothing to scale.

- **Only `data` survives the hop.** `God/ClusterMode.js:65` emits `{at, data,
  process:{pm_id, name, rev, namespace}}` — a `topic` field on the message is
  dropped, so the topic travels *inside* `data`
  (`IN_FLIGHT_REPORT_TOPIC = 'processes:in-flight'`, `processes/types/messages.ts`).
- Worker side: `api/src/processes/lib/report-in-flight.ts`, wired from
  `server.ts` `createServer()`. Counts on `server.on('request')`, uncounts on
  `response.once('close')` — `close` fires for a finished response *and* for a
  socket that went away, so an aborted request does not pin the worker as busy.
  No-ops when `process.send` is absent.
- Autoscaler side: `api/src/processes/autoscale/lib/in-flight.ts` over
  `watchWorkerMessages()` in the supervisor gateway. A report older than 3 s
  reads as **null, not zero** — a worker too busy to run its timer says exactly
  what an idle one says.
- **pm2 takes the bus socket down with the calling one** (`Client.close` runs
  `disconnectRPC` *and* `disconnectBus`, Client.js:189), so `connect()` relaunches
  the bus. Without that a reconnect leaves the autoscaler deciding on reports
  that silently stopped arriving. Pinned by `a reconnect puts the worker bus back`.

## The victim

`decide()` still returns a **count**; `choose-victims.ts` picks *which*, and
`releaseWorker(pmId)` → `pm2.delete` stops it. Growth still names a size.

Ranking: reported-idle → reported-nothing → serving, fewest first. Tiebreak
inside a rank is **lowest `pm_id`, which is pm2's own order**, so a pool with no
signal is released exactly as before and a signal that stops arriving costs
nothing. Rank 2 above rank 3 because silence is not idleness.

`pm2.delete` is published and typed (`pm2/types/index.d.ts:87-91`); `pm2.scale`
is not (hand-declared `ScalableSupervisor`). Same daemon call either way, so
naming the victim *reduces* untyped pm2 surface.

## pm2 typings gaps hit so far

`disconnect(cb)` (runtime takes a callback since 2.x, typings say
`disconnect(): void`) and `scale`. Each is covered by a local interface over the
call, never a cast at the call site. The `disconnect` one only showed up as
vitest's **ambient `Errors 1`** line on a full-package CI run — see
[[project_directus_vitest_typecheck_gate]]; a per-directory local run reports
`Type Errors  no errors` and hides it. Baseline-diff `npx tsc -p api --noEmit`
instead (the worktree's shared `node_modules` makes its absolute count useless —
[[project_directus_worktree_shared_node_modules]]).

## The bb rig can stage this

`startPool({inFlight, inFlightBusyInstance})` makes a fixture worker report a
fixed count, and `instancesOf(rig)` says which pm2 instance numbers survived —
instance 0 is pm2's own first pick, so the survivor's number is the whole claim.
It cannot stage *uneven CPU* across workers: every worker runs one
`busyMs`/`idleMs` duty cycle, which is why #484's lopsided-pool case is unit-only.
