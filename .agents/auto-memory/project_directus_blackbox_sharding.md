---
name: project_directus_blackbox_sharding
description: Blackbox test sharding — vendor×shard matrix, the per-shard completion barrier, how the after-chain is distributed, measured per-file weights, and why build-caching HURTS
metadata:
  type: project
---

Blackbox `db` tests sharded across parallel CI jobs (PR #213 branch). `tests/blackbox/` harness + `.github/workflows/blackbox.yml`.

**Design:** `blackbox.yml` `shards` input (default 5) → setup emits `[1..N]` → db matrix = `vendor × shard` (each a fresh runner+DB, fully isolated). Run cmd passes `--shard=i/N` + `SHARD_INDEX/COUNT`. Coverage: each shard uploads a partial lcov under `-F blackbox`; **codecov merges server-side** → union == full-run coverage (verify via [[project_directus_codecov_flags]] API).
- `setup/shard-files.ts` `filesForShard`: deterministic partition. `before` files → EVERY shard (the barrier needs them). `parallel` AND `after` are bin-packed together by `fileWeight`; each shard runs its own after-share last, in declaration order. An `after` entry may be a nested array = an ordered CHAIN that must stay in one shard (the timezone trio: `-america` reads back rows `timezone.test.ts` inserted, `-asia` reads back both).
- **Weights are measured ms, not byte size.** The old table hinted 7 files and fell back to `fs.statSync().size` for the rest, so the packer compared milliseconds against bytes. Refresh them from a run whenever the spread drifts.
- `setup/sequencer.ts` `shard()` applies it under `this.ctx.config.shard`; `sort()` orders [before→middle→after], writes `sequencer-data.json{totalTestsCount}`.
- **Barrier** (`setup/environment.ts`): each file polls `/items/tests_flow_completed` count; `getReversedTestIndex` gives before=positive, middle=`before.length`, after=negative (`totalTestsCount + index === completed`). Works per-shard ONLY if the shard has ALL before files, **and the after index must count back from the SHARD's own after subset** — the sequencer writes `afterFiles` into `sequencer-data.json` for exactly this. Against the project-wide list, a shard holding part of the chain waits on completions that never happen there and hangs (it does not fail).
- `seed-database.test.ts`: seed-scoped to the shard's files — **plus the seeds those files BORROW**. A test can import another test's seed (`batch-insert` imports `no-relation.seed`, `m2o-max-batch-mutation.seed` re-exports `m2o.seed`), which the 1:1 seed↔test filename mapping cannot see. The seeder walks `from './x.seed'` imports transitively. Symptom when it is missed: every case in the borrowing file returns **403**.

**Gotchas that bit this session (all cost a ~12min CI cycle):**
- `sort()` THREW on a before/after file not in the shard → guard the throw with `if (!this.ctx.config.shard)`.
- vitest fails a file/describe with **zero tests** ("No test found in suite", no `passWithNoTests`) → guard vendor-filtered describes (`it.skip` when the filtered vendor set is empty). Bit BOTH the priority and the exhaust describe.
- websocket connect timeout was 5s (`common/transport.ts`) → too tight under sharded load → `OPEN state` flake on the slowest vendor (sqlite3) → bumped to 10s (still < 15s testTimeout).

**Wall-clock floor:** `Prepare`(build, ~2min FIXED/job) + `before`(~2min) + max(single biggest FILE, serial `after`-chain). Shard count helps until each heavy unit (5 relational monsters + after-chain) is isolated (~N=5 → ~10.8min from ~18min); more shards can't beat the single 6min `m2m` file or the serial after-chain.

**Build-caching is a NET LOSS here** (counterintuitive): the ~2min build already runs in PARALLEL across all shard jobs (free runners), so it's overlapped. A shared build-job serializes it onto the critical path (`build → shards`) → +~1.5min. Only wins when builds are serial on one machine. See [[project_directus_db_connection_priority]].

**2026-08-05 (PR #328) — the after-chain distribution now WORKS and is the default.**
The earlier "reverted" note below was true against its own numbers and is now stale:
`m2m` is no longer ~6min (measured 76s), so it is not the floor. What was:

| pg shard | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| before | 185s | 245s | 198s | 248s | **668s** |
| after | ~235s each, flat | | | | |

The 668s shard held the whole after-chain, half of it one file. Fixes: distribute
`after`, measure the weights, split `websocket/auth.test.ts`. Its 350s was **pure
waiting** — 350246ms on postgres against 350218ms on sqlite, 28ms apart on two
different databases. Per method: public 38s, handshake 118s, strict 194s; the spread
is entirely the ping cases, which wait out the 20s `getMessages` default for a pong
the server answers by closing the socket. Split `connects`/`pings` per method.

**Historical, superseded — distributing the after-chain across shards** (per-file `waitFor` barrier replacing the global after-ordering): it does NOT help. The single `m2m.test.ts` file (~6min, unsplittable) is the real floor (~10min with overhead), not the after-chain — so distributing `after` just swaps one ~10min shard (after-shard) for another (m2m-shard). Gained ~0.5min AND broke a shard (deterministic). To go below ~10min you must SPLIT the `m2m`/`o2m` mega-files (2600 tests each) into multiple files — the after-chain isn't the bottleneck.
