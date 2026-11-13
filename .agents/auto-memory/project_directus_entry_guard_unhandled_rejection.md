---
name: project_directus_entry_guard_unhandled_rejection
description: extensions/manager.ts floats messenger.subscribe(); loadExtensions() runs during CLI construction before any command-action guard is installed → dead Redis kills the process before a single log line; fixed with an import-side-effect entry-guard, not a body call
metadata:
  author: Jean Claveau
  type: project
---

Found 2026-09-10 hunting a blackbox shard-7 failure on PR #475
([[project_directus_shared_settings_source_of_truth]]).

## The bug

`extensions/manager.ts:222` calls `this.messenger.subscribe(...)` without
awaiting or catching it. Against a dead Redis, ioredis parks the SUBSCRIBE in
its offline queue; once `retryAttempts` passes `maxRetriesPerRequest` (default
20), `closeHandler` calls `flushQueue(new MaxRetriesPerRequestError(...))`,
rejecting that floating promise. `optimizeErrorStack` rewrites the stack to
the construction site, which is why the fatal print pointed into ioredis
instead of the caller.

`createCli()` does `await loadExtensions()` → `extensionManager.initialize()`
— i.e. that subscribe happens while the **CLI is still being built**, before
any command action runs. Both existing `process.on('unhandledRejection', …)`
installs (`server.ts:179`, `processes/autoscale/index.ts:79`) sit *inside*
command actions, so CLI construction plus the module-import graph of whichever
command is invoked (the autoscaler's `import('../processes/autoscale/index.js')`
drags in pm2, several seconds) all runs unguarded. The rejection lands in that
window → Node fatal exit 1, before a single `[autoscale]` log line.

**Not specific to the autoscaler** — `directus start` has the identical hole,
it just usually boots faster than ioredis's ~11s default retry budget, so it
rarely trips in practice.

## The wrong first fix, and why it was wrong

First attempt put `guardUnhandledRejections()` in `cli/run.ts`'s function
body, before `createCli()`, and was reported as fixed (unit tests all green).
It wasn't — CI kept failing the same arm. Reproduced locally by running the
real `cli/run.ts` via `tsx` (not the blackbox-built dist) against a dead
Redis: a probe `console.error` placed right after the guard call **never
printed**. The rejection arrives while `import { createCli } from './index.js'`
is still evaluating its import graph — and a module's body only runs *after*
its whole graph has finished evaluating. So a call inside the body is
structurally too late no matter where it sits.

**Real fix:** `api/src/entry-guard.ts`, a module whose only job is the
`process.on('unhandledRejection', …)` side effect, imported *first* by both
`cli/run.ts` and `start.ts` (`import './entry-guard.js'` as the first
import). Being an import means it runs during graph evaluation, before the
vulnerable subscribe. Made idempotent so multiple entry points and the
existing in-action installs can all take it without double-counting.

Measured A/B, one import line the only variable (same dead-Redis command):

| | exit | guard lines | fatal |
|---|---|---|---|
| `import '../entry-guard.js'` present | 0 | 1 | — |
| removed | 1 | 0 | `MaxRetriesPerRequestError` ×2 |

Also confirmed genuinely a *rejection* not an uncaught exception:
`--unhandled-rejections=warn` lets the same run survive and print its answer.

## The lesson generalized

A guard/handler installed as a **function-body statement** cannot protect
against anything that can go wrong during **module import-graph evaluation**
of that same file or an earlier import — only another import's side effect
runs early enough. When a "should be fixed" claim rests on unit tests alone
after a boot-order bug, reproduce with a real process spawn (`tsx` against
source, not the built dist) and a probe placed right after the call site
before trusting it. See [[feedback_regression_test_must_fail_without_fix]]
and [[feedback_instrument_before_theorising]] — this is that pattern applied
to a boot-order bug specifically.

## The regression test had to be deliberately non-vacuous

`tests/blackbox/tests/db/app/cli-boot-redis-outage.test.ts` spawns one CLI
command against a dead Redis with `REDIS_MAX_RETRIES_PER_REQUEST=1` +
`REDIS_RETRY_BASE_DELAY=1` (both newly registered in `TYPE_MAP`, since ioredis
gates the flush on `typeof maxRetriesPerRequest === 'number'`) — this moves
`flushQueue` to ~2-4ms, squarely inside `loadExtensions()`. Without forcing
the retry budget down, a plain `directus start` arm would pass with or
without the fix (it boots faster than the default 20-attempt budget), making
it vacuous — which is why a naive `start`-path arm wasn't added first. Also
pins `REDIS: ''` explicitly, since `directusConfig` spreads `process.env` and
a runner-set `REDIS` URL would otherwise bypass the dead-port override.
