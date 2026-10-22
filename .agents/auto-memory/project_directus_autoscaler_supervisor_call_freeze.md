---
name: project_directus_autoscaler_supervisor_call_freeze
description: A pm2 call whose daemon dies mid-flight never calls back, and the autoscaler's tick awaited it bare — a silent permanent freeze, fixed with a 15s bound plus reconnect in pool.ts
metadata:
  type: project
---

The `autoscale-supervisor-restart` blackbox arm was intermittent (measured
2 failures in 24 local cycles, and one CI red on PR #456). Root cause is a
source bug, not test flake.

**What happens.** `pm2 kill` takes the daemon down while the autoscaler has a
call in flight. pm2's client sends over a socket that reconnects on its own, so
the call is neither answered nor failed — the callback is held for a reply
nothing will ever send. `readPool` and `scaleTo` awaited those promises bare, so
the `for(;;)` tick stops on that line, forever. Silently: the loop's `catch`
never runs, and a decision that is never taken is not logged.

**How it was proved.** Instrumenting the failing cycle showed the autoscaler
process alive, `wchan: ep_poll`, and **0 CPU ticks over 3 seconds** while the
worker was reporting 17.9% CPU against a threshold of 5. A loop merely deciding
"nothing to do" burns a pm2 list RPC every second; 738 -> 738 is a dead loop.

**The fix** (`api/src/autoscale/lib/pool.ts`): `answeredInTime(what, call)`
races every supervisor call against `SUPERVISOR_TIMEOUT_MS = 15_000`, and on
timeout swallows the abandoned call, `pm2.disconnect()` + reconnects, then
throws so the tick's catch logs it. A call that fails on its own passes straight
through with no reconnect — pm2 refusing a scale is an answer. 15s is above
pm2's default `listen_timeout` of 8s; a deployment raising `PM2_LISTEN_TIMEOUT`
past it costs a log line and a reissue, not a wrong pool, because a scale names
an absolute size.

**Why it matters in production:** `pm2 update`, an OOM'd daemon, or any
supervisor restarted under a running autoscaler produces exactly this. The pool
freezes at whatever size the daemon went down at and nothing says so.

**How to apply:** never `await` a pm2 (or any callback-RPC) promise bare in a
supervisor loop. And when a loop "stops deciding", measure CPU ticks before
theorising about the decision logic — a frozen await and a loop deciding null
look identical in the log.
See [[project_directus_pr456_autoscaler_design]],
[[project_directus_blackbox_flakes]].

## The reconnect itself raced, and killed the process (2026-09-10)

The 15s bound's recovery path was `pm2.disconnect(); await connect();` with no
gate. pm2 finishes a connection it has already started against the client it
finds when the socket lands (`Client.js:365`, `connectHandler` →
`self.client.sock.removeListener`), so a disconnect issued while a connect is in
flight leaves that callback reading a null client:

```
TypeError: Cannot read properties of null (reading 'sock')
```

thrown from inside a socket handler, where no call is left to carry it — an
uncaught exception, so the autoscaler exits 1. The same freeze this bound exists
to prevent, by the other door. A supervisor restarted under a running loop is
exactly the overlap: every hanging call times out and each asks for the same
reconnect a tick apart.

Fixed by serialising: a module-level `reconnecting` promise in `pool.ts`, one
reconnect however many callers found the supervisor gone, cleared in `finally` so
a failed one does not hold the next. Two unit arms in `pool.test.ts` (one
connection taken down and one asked for on behalf of two callers; a failed
reconnect does not wedge the gate). This is what
`autoscale-supervisor-restart.test.ts` had been failing on — the arm was right
and the intermittency was the bug, again.
