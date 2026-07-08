---
name: project_directus_blackbox_sharding
description: Blackbox test sharding — vendor×shard matrix, the ordering-barrier constraints, the wall-clock floor, and why build-caching HURTS
metadata:
  type: project
---

Blackbox `db` tests sharded across parallel CI jobs (PR #213 branch). `tests/blackbox/` harness + `.github/workflows/blackbox.yml`.

**Design:** `blackbox.yml` `shards` input (default 5) → setup emits `[1..N]` → db matrix = `vendor × shard` (each a fresh runner+DB, fully isolated). Run cmd passes `--shard=i/N` + `SHARD_INDEX/COUNT`. Coverage: each shard uploads a partial lcov under `-F blackbox`; **codecov merges server-side** → union == full-run coverage (verify via [[project_directus_codecov_flags]] API).
- `setup/shard-files.ts` `filesForShard`: deterministic partition. `before` files → EVERY shard (the barrier needs them). `parallel` (+ `after`, currently last-shard-only) bin-packed by `fileWeight` (duration hints for the 5 relational monsters, else byte size).
- `setup/sequencer.ts` `shard()` applies it under `this.ctx.config.shard`; `sort()` orders [before→middle→after], writes `sequencer-data.json{totalTestsCount}`.
- **Barrier** (`setup/environment.ts`): each file polls `/items/tests_flow_completed` count; `getReversedTestIndex` gives before=positive, middle=`before.length`, after=negative. Works per-shard ONLY if the shard has ALL before files.
- `seed-database.test.ts`: seed-scoped to the shard's files (reuses its `only`-filter shape).

**Gotchas that bit this session (all cost a ~12min CI cycle):**
- `sort()` THREW on a before/after file not in the shard → guard the throw with `if (!this.ctx.config.shard)`.
- vitest fails a file/describe with **zero tests** ("No test found in suite", no `passWithNoTests`) → guard vendor-filtered describes (`it.skip` when the filtered vendor set is empty). Bit BOTH the priority and the exhaust describe.
- websocket connect timeout was 5s (`common/transport.ts`) → too tight under sharded load → `OPEN state` flake on the slowest vendor (sqlite3) → bumped to 10s (still < 15s testTimeout).

**Wall-clock floor:** `Prepare`(build, ~2min FIXED/job) + `before`(~2min) + max(single biggest FILE, serial `after`-chain). Shard count helps until each heavy unit (5 relational monsters + after-chain) is isolated (~N=5 → ~10.8min from ~18min); more shards can't beat the single 6min `m2m` file or the serial after-chain.

**Build-caching is a NET LOSS here** (counterintuitive): the ~2min build already runs in PARALLEL across all shard jobs (free runners), so it's overlapped. A shared build-job serializes it onto the critical path (`build → shards`) → +~1.5min. Only wins when builds are serial on one machine. See [[project_directus_db_connection_priority]].

**Tried + REVERTED — distributing the after-chain across shards** (per-file `waitFor` barrier replacing the global after-ordering): it does NOT help. The single `m2m.test.ts` file (~6min, unsplittable) is the real floor (~10min with overhead), not the after-chain — so distributing `after` just swaps one ~10min shard (after-shard) for another (m2m-shard). Gained ~0.5min AND broke a shard (deterministic). To go below ~10min you must SPLIT the `m2m`/`o2m` mega-files (2600 tests each) into multiple files — the after-chain isn't the bottleneck.
