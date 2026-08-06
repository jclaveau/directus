---
name: project_directus_blackbox_websocket_flake
description: The shard-8 m2o-max-batch websocket flake — root cause was graphql-ws closing its own socket (lazy:true), NOT shard placement; plus the postgres 42703 race from concurrent server-spawning suites
metadata:
  type: project
---

Two real defects, found while rebalancing the blackbox shards (#328). Both had been
latent for a long time and only surfaced when the packer changed which files ran
together.

**1. `m2o-max-batch-mutation` websocket flake — `createWebSocketGql` never set `lazy`.**
graphql-ws defaults to `lazy: true` with `lazyCloseTimeout: 0`, so the client tears
down its OWN socket the instant no subscription is active — cleanly, code 1000. The
tests own that connection's lifetime (`client.dispose()`), so any gap between a
subscription finishing and the next assertion let the socket vanish, and
`waitForState(OPEN)` burned its full 20s. Fixed with `lazy: false`.
- Timing-dependent ⇒ CI-only, never reproduced locally across dozens of runs with a
  clean OR an istanbul-instrumented build, and it favoured the later pkTypes in a
  file that slows as it goes.
- **Placement is irrelevant.** A reserved parallel-free shard, an ordering group,
  and a "known-good neighbour" each passed once and failed once — noise, not cause.
- It was undiagnosable for nine rounds because `common/transport.ts` had
  `conn.on('error', () => { return; })`, discarding the socket's own account. Both
  factories now record `error`/`close` (and the graphql-ws `closed`/`error` hooks)
  into the timeout message next to `readyState`. Keep that.

**2. 11 server-spawning suites raced in the parallel middle.** 19 files
`spawn('node', [cli,'start'])`; 11 were not in the serialised `after` list.
`cache-takeover-scope` lost a race applying a unique constraint before its own M2M
junction columns existed (postgres **42703**). They now all sit in `after`.

**Diagnostics that exist now:** `TEST_SAVE_LOGS: '1'` in the workflow (setup.ts only
writes `server-log-<vendor>.txt` when set, and only on server exit) plus a
`failure()` step dumping them. Read them from the run-logs ZIP — the job-logs API
drops the big test step.

Related: [[project_directus_blackbox_sharding]], [[feedback_instrument_before_theorising]].
