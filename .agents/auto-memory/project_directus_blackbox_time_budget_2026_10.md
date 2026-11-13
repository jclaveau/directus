---
name: project_directus_blackbox_time_budget_2026_10
description: Where a blackbox shard's 418-518s goes (before-chain dup, autoscale files, 20s ws waits, 5s connect poll) + ranked refactor levers and what jean approved
metadata:
  author: Jean Claveau
  type: project
---

Measured on PR #586 run (36795957049), per shard "Run tests" 418–518s:
- ~17s start 2 shared servers; `before` chain 85–147s (serial, duplicated on ALL 8 shards);
  rest = up to 6 files at once. Last-finishing file = an `autoscale-*` on 6 of 8 shards.
- Test cases >300ms sum 3245s: autoscale-* (19 files) ~1300s (40%; each case spawns its own pm2
  daemon + pool; heaviest prewarm-health 227s, release 223s, ramp 166s); 4 plain-test `before`
  files (schema, collections crud, change-fields, fields crud) ~65s/shard = ~7.5 runner-min/run
  wasted; WS ping tests ~270s (rejected ping closes socket but `getMessages` in
  `common/transport.ts` polls to its 20s timeout).
- `awaitDirectusConnection` polled every **5000ms** → every spawned server waits ≥5s; 141 files
  depend on it. Cut to 200ms, same overall timeout.
- Unexplained: autoscale-ramp 362s wall vs 166s of cases + ~85s before-wait → ~110s unaccounted
  (setup/teardown or CPU contention) → why per-file timings reporter was added.
- Run-to-run noise ~53s: a gain smaller than that is unprovable on one run; #2/#3 need several runs per arm.

**Jean's rulings:** (1) fail-fast on closed socket: go. (2) move the 4 test-only `before` files to
one shard: check dependencies, go if validated. (3) split heaviest autoscale files one-per-case
(like the earlier websocket/auth split): "let's try". (5) add every timing that helps optimise bb
and upload as artifacts for future use (per-file start/end, setup/teardown, per-test, before-wait,
server boot, CPU/mem sampler per shard). Refactor generally warranted — many files added for cache.

**Rejected/deferred:** vitest `test.extend` shared-server fixtures — 144 files spawn their own
Directus (differing env) and fixtures share only within one worker, not across; gain unmeasured.
`it.concurrent` inside autoscale files — risky (assertions on measured CPU %, 4-vCPU runner skew).

**Why:** blackbox is the CI critical path (8 shards, wall = slowest shard).
**How to apply:** before another bb perf change, read the timings artifact first; prove with
several runs. See [[project_directus_blackbox_shard_weighting]], [[project_directus_blackbox_sharding]],
[[project_directus_blackbox_websocket_flake]].
