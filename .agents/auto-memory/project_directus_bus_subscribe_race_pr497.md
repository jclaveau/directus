---
name: project_directus_bus_subscribe_race_pr497
description: Issue #496/PR #497 — ioredis 5.11 subscribes during the ~1-2ms 'connect'-not-'ready' window silently and permanently lose the subscription; fixed in packages/memory's BusRedis; root cause of a blackbox flake that PR #492 exposed (not caused)
metadata:
  author: Jean Claveau
  type: project
---

**Root cause (ioredis 5.11.1, reproduced outside CI in a throwaway probe):**
1. Since ioredis 5.11, `connect` fires, then `CLIENT SETINFO` ×2 (async), then
   an `INFO` ready-check — a ~1-2ms window where `status === 'connect'`, not
   `'ready'`.
2. A `subscribe` issued in that window carries the `loading` flag, so ioredis
   writes it **immediately** instead of offline-queueing it. The reply flips
   the connection into subscriber mode.
3. The ready-check's own `INFO` is then rejected: `Connection in subscriber
   mode, only subscriber commands may be used` — the exact CI error.
4. ioredis's `recoverFromFatalError` reconnects, but `closeHandler` only
   captures `prevCondition` when `prevStatus === 'ready'` — so nothing gets
   resubscribed. `BusRedis.handlers` still holds the channel; the process is
   deaf on it **forever, with no log**.

Deterministic probe result (subscribe issued at various delays after bus
creation): 0ms (`connecting`) → fine; 1-2ms (`connect`) → rejected, silently
lost; 3ms+ (`ready`) → fine.

**Why PR #492 exposed it, not caused it:** #492's metrics door
([[project_directus_autoscaler_process_ram]]) took `cache.ts` off the
autoscaler's *static* import graph. `cache.ts:37` does `useBus().subscribe
('schemaChanged')` at module load. After #492 it's first reached via
`readSharedSettings`'s dynamic `import('../../database/index.js')` — now
landing milliseconds after `initProcessReports()` created the bus, instead of
before it, so the boot-time subscribe calls straddle the 1-2ms handshake
window instead of all clearing it before the subscription existed. Pure
timing reorder; #492's own CI run and the pre-merge branch were both green.

**Manifested as a blackbox flake, but was NOT a flake** — twice-failed on
rerun (0/2), same `autoscale-mcp-levers.test.ts` arms, same error both times.
The `running=[]` symptom was the autoscaler's own `PROCESSES_QUERY_CHANNEL`
subscribe (`readAutoscaleRunners` → `collectProcesses`) losing the race — no
`could not answer processes queries` warning, because the subscribe call
itself had *resolved*, just silently dropped. See
[[project_directus_blackbox_flakes]] for the general triage method (2+
identical reruns red ⇒ investigate, don't keep rerunning).

**Fix** (`packages/memory/src/bus/lib/redis.ts`, PR #497,
`v11.10.1-fix/bus-subscribe-before-ready`, `Fixes #496`):
1. A `subscribe` issued while status is `connect` now awaits `ready`/`close`
   first (`readyCheckSettled()`), mirroring what the offline queue already does
   for non-`loading` commands at other statuses.
2. On every subscriber `ready` event, resubscribe everything already in
   `this.handlers` — heals any future loss ioredis itself won't recover from,
   not just this one window.

8 new unit tests (27 total in the suite), each of 6 mutants killed. Merged to
trunk before merging back into #494 (which then needed `origin/v11.10.1-hhh-dev`
merged in to pick the fix up and go green).

**Alternative considered and rejected:** `enableReadyCheck: false` on the
duplicate connection — skips the `INFO` call entirely, but loses the
`loading`-flag guard the ready check exists for. Not used.

**Deep review pass (before merge), findings + dispositions:**
1. 🟡 fixed — `this.handlers` was read inside the `'ready'` closure 12 lines
   before its own `= {}` assignment; runtime-safe (closure fires later) but
   wrong reading order. Moved the assignment above the listener. Amended into
   the same commit, force-pushed.
2. 🔵 disclosed, no change — a second `subscribe()` on the same channel while
   the first is still held (`existingSet` branch) now resolves ~1 RTT later
   than before the fix, because it resolves only after `readyCheckSettled()`.
   Pre-existing shape (handler set before the await); the fix widens an
   existing window, doesn't create one.
3. 🔵 disclosed, no change — if `retryStrategy` gives up after a failed ready
   check, the held subscribe releases into status `end` and rejects
   `Connection is closed.`; the resubscribe-on-`ready` belt can't heal a dead
   client. Identical behavior to pre-fix.
4. 🔵 accepted as-is — the `Forwards a refused subscribe` test counts two
   `await Promise.resolve()` microtask ticks, brittle to any change in the
   `.catch` chain shape. Left as is (jean's call).
5. 🔵 parked — no deterministic integration witness exists; the blackbox
   witness (`autoscale-mcp-levers`) depends on shard layout matching the
   original failure, and the unit tests replay ioredis events by hand against
   fidelity established only by a throwaway probe script (not in the repo).
   Optional follow-up: a real-Redis integration test in `packages/memory`
   that reproduces the 1-2ms delay directly.

No correctness defect found. **Merged to trunk as `0fc1af2a66`** (single
amended commit, final head `1362ad0a61`, `Fixes #496` — issue closed). CI
witness: run `35034570033`, 8/8 postgres blackbox shards green, the
`autoscale-mcp-levers` witness landed on shard 7 (same shard #494 failed on)
— 3/3 tests green, consistent with the fix but not a deterministic pin
(different diff → different shard weights than #494's).
