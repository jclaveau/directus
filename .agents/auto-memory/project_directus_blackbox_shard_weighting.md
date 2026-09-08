---
name: project_directus_blackbox_shard_weighting
description: How the blackbox shard packer weights files (ms hints, else SOURCE BYTES) and why rebalancing it does not move wall clock — maxForks 6 plus a 53s run-to-run noise band
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

Related: [[project_directus_blackbox_sharding]], [[feedback_match_instrument_to_effect_size]].
