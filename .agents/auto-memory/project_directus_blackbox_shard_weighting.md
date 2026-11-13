---
name: project_directus_blackbox_shard_weighting
description: How the blackbox shard packer weights files (ms hints, else SOURCE BYTES); the serial after chain is the real critical path (PR #590), the timings artifact replaces log archaeology
metadata:
  type: project
---

`tests/blackbox/setup/shard-files.ts` packs files heaviest-first into the least-loaded
bucket. `fileWeight` returns the `DURATION_HINTS_MS` entry if one matches the path
suffix, **else `fs.statSync(file).size` — bytes competing directly against
milliseconds**. Files are discovered by an fs scan, so a new test file needs no
registration; it just gets weighted by its source size.

That fallback is wrong for verbose-but-fast files. The five added by #427 were
over-weighted 6x to 34x (a 141 ms file read as 4731).

**Rebalancing it does not speed up the gate.** Measured, do not re-derive:
- The packer was already balanced to **0.5%** in its own units while the shards ranged
  **230-315 s (27%)**. A model that precise and that wrong is not the cause.
- `vitest.config.ts` sets `maxForks: 6`, so a shard's wall clock is the critical path
  across six lanes plus the fixed cost every shard pays (bootstrap, the shared `before`
  files) — not the sum of weights being balanced.
- Run-to-run noise over 8 runs of the same branch: max **305-358 s**, spread
  **70-134 s**. A 10 s change is unmeasurable at n=1 per side; separating it would take
  ~8-10 runs each way ([[feedback_size_verification_to_failure_rate]]).

**How to apply:** add accurate hints for new files because the weights should not lie,
and say in the commit that it is a correctness fix, not a speedup. If asked to actually
even out the shards, the levers are the fixed per-shard cost paid 8x and packing on
critical path rather than summed weight — measure the fixed cost first. Simulate any
weight change against the real file list before believing it
([[feedback_prove_the_lever_is_connected]]).

**2026-10-01, the critical path found (PR #590).** Per-shard phases from run
36795957049: before 85-147s, middle 20-137s, **after 174-343s, the end of every shard**.
The `after` chain is serial and starts only when every middle file has completed, while the packer
weighed after and middle files at the same cost. PR #590:
- makes the cost model `after + middle / MAX_WORKERS`;
- splits the 2 x 230s autoscale files;
- re-measures the after hints (mcp-levers 120 vs 16s, supervisor-options 90 vs 6s, cache-purge-recovery 20 vs 92s);
- runs the 4 test-only `before` files on shard 1 only.

Every run now uploads `blackbox-timings-*` (90 days); read it with `pnpm timings <dir>` instead of
re-deriving phases from logs. Outcome: see [[project_directus_pr590_faster_blackbox]].

Related: [[project_directus_blackbox_sharding]], [[feedback_match_instrument_to_effect_size]].

**Measured on #590 run 36836067720 vs 10 recent green runs:**

| per-shard `Run tests` | baseline | #590 |
|---|---|---|
| max | 501-540 s | 431 s |
| median | 445-475 s | 291 s |
| sum | 3526-3790 s | 2435 s (-33%) |

- The before phase dropped from 85-147 s to 9-21 s on shards 2-8.
- `auth-*-pings` now take under 14 s each.
- Middle files really run **3.2-4.9 in parallel on the 4-vCPU runner, not 6**, and inflate up to about 2x when they run side by side (m2m 76 -> 159 s). So: middle cost = `max(sum/3.5, longest file)`.
- The serial `after` chain, about 290 s per shard, is now the floor.
- Seed race seen in shard 6, 42703 `column outside_owner.reviewed_notes does not exist` (cache-o2m-outside-scope-fk). It is the [[project_directus_blackbox_websocket_flake]] race class.

**Run 2 (36838134166, after the longest-middle floor):** `Run tests` max 324 vs 501-540 s, median 305, sum 2380 s; shards end 253-320 s (run 1: 238-428 s). The model predicted 319 s, so `max(sum/3.5, longest)` holds.

**The after chain is 1784 s of serial weight, 1051 s of it autoscale** (ramp 170, prewarm/release splits 115-125 each). Moving 13 cache suites (4-11 s each) back to the middle was MEASURED at zero gain (run 36840220850: max 325 vs 324 s, sum 2436 vs 2380 s) and raised flush pressure: their system-cache clears on the shared server made `graphql-ip-gated-read` exhaust its 5 rebuild retries. Reverted (`6adcd95e37`). Don't retry it; the lever is autoscale.

**MERGED 2026-10-01 as `d26a60f1e7`.** Final run 36841336131 on `6adcd95e37`: `Run tests` max 335 s, median 298 s, sum 2382 s; job max 474 s, wall 493 s; all 8 shards green.
