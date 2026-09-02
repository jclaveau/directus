---
name: project_directus_blackbox_flakes
description: known intermittent blackbox flakes in jclaveau/directus CI (m2o.test.ts WebSocket-OPEN timeout) + how to rerun a failed shard — don't chase these as real bugs
metadata:
  type: project
---

**⚠️ 2026-07-27: the three flakes below are FIXED. Don't chase them; if one recurs, the fix regressed.**
- **m2o WS flake (#277) → FIXED in #311** (merged `a6b26ff57e`). Real root cause was NOT the 120s ceiling — it was **WebSocket handshake starvation**: the MAX_BATCH_MUTATION tests (the only WS users in `m2o.test.ts`) open a WS conn + GraphQL-WS sub against the shared instance while running in the **6-fork parallel pool** (`vitest.config.ts` maxForks:6); under load the handshake blows its 20s `waitTimeout` (`transport.ts` `defaults`) → OPEN-state reject. testTimeout is 30s, not 120s. Fix: extracted the block to `m2o-max-batch-mutation.test.ts` in the sequential `after` list (WS suites already there) → no concurrent starvation. Adjacent retry-unsafe tracker split to **#312** (open).
- **seed-403 schema-cache race (#308) → FIXED.** `CreateItem` now seeds on the cache server, falls back to `getNoCacheUrl` on a 403 (fresh schema). See [[project_directus_blackbox_seed_mechanics]].
- **no-cache server EADDRINUSE (#309) → FIXED in #310.** Test server ports (was 591xx) sat inside the OS ephemeral range (32768-60999) → outbound socket grabbed a listen port as its source port → bind fail. Moved to 201xx (below the range).

**HISTORICAL (pre-fix) signature** at `common/transport.ts:333` — `WebSocket failed to achieve the OPEN state` / `Timeout._onTimeout` on `m2o.test.ts > … MAX_BATCH_MUTATION > … errors when above limit`. Was misattributed to a "120s vitest ceiling"; the true cause was WS-handshake-under-6-fork-concurrency (see above). A cache/schema/unit change can't touch the transport.
- The test harness's realtime transport times out establishing/serving the connection, unrelated to the
  assertion under test.
- **Non-deterministic** — PR #225 hit it twice running: postgres shard 4 (3 tests) then sqlite3 shard 4 (1
  test), different db/count each time; base branch (hhh-dev) runs were all green. So it's environmental
  (runner load / WS handshake timing), not a code regression. Don't attribute it to your diff — a cache /
  schema / unit change has nothing to do with the WS transport.
- **Reruns RELOCATE it, they don't reliably clear it.** PR #289 hit it on 4 consecutive runs —
  sqlite3 shard 4 (×2 incl. a `--failed` rerun), then postgres shard 4 — a DIFFERENT random shard
  each run, always the same `m2o` WS test, always 1/4282. So don't chase it with reruns (each just
  moves it + burns ~12min of CI). **If it's the ONLY red and the real target passed** (here
  `cache.test.ts` was green on shard 5, both vendors, every run) + unit is green → treat it as
  **non-blocking and merge** (jean: "merge and close"). Confirm the diff's own test file passed on
  its shard rather than re-running. (#292 counter-case: it DID clear on the 2nd `--failed` rerun — run red → rerun 1 red, fewer tests → rerun 2 green. So a couple reruns can clear it; escalate only past ~3.)

**Second flake signature — seed 403 schema/permission-cache race** (distinct from the m2o WS timeout above). `CreateItem` in a test's `beforeAll` fails with **`403 FORBIDDEN` "You don't have permission to access this."** on a collection created moments earlier by `CreateCollections` — the instance's permission-resolved schema cache hasn't propagated the new collection yet, so even the admin token is denied. Cascades to `afterAll` `instance.kill()` on undefined. Seen 2026-07-27 across postgres shards 2/3/5 on cache-unautopurgeable-scope + cache-cancel-write (both #292 tests); the failing shard SHIFTS run-to-run = load/timing race, not a test bug.
- **The true cause was masked** — the old `CreateItem` threw `new Error('Could not create item', response.body)` (mis-passing body as Error's `cause`), logging NO status. Adding `${status} ${JSON.stringify(body)}` to the throw revealed the 403 immediately ([[feedback_verify_repro_before_claiming_deterministic]]: a better error message beats guessing — I'd wrongly assumed pool contention).
- **Fix = retry `CreateItem`** ([[project_directus_pr306_purge_for_mutated_rows]] #308) — but a 4×(200/400/600ms ≈1.2s) window was TOO SHORT; the schema-cache lag outlasts it. Needs more attempts / longer backoff, or a schema-cache-propagation wait after `CreateCollections`. NOT yet proven to clear it.
- **Adding blackbox test FILES aggravates it** — more collections seeded concurrently against the shared default instance = more schema-cache churn. My 2 new files (#306) tipped it onto more shards.

**Rerun mechanics:**
- `gh run rerun <run-id> --failed -R jclaveau/directus` — reruns only the failed jobs, but ONLY after the
  whole run has completed. Mid-run it's blocked with the MISLEADING error `run … cannot be rerun; its
  workflow file may be broken` — that does NOT mean a broken workflow; it means slow shards (shard 5
  ~13-14min) are still `in_progress`. Wait for run `status=completed`. Also: the FIRST call can succeed
  silently (no output) and actually trigger; a 2nd call then says "cannot be rerun" (already rerunning) —
  verify via job `status`, don't assume it failed.
- `gh run rerun --job <job-id>` fails with `cannot be rerun` while sibling shards are still in progress.
- Pushing a new commit is a full rerun (all shards) — usually simpler than waiting to rerun one shard.
- If the SAME flake recurs 3+ times, it's a hot flake — flag it for jean rather than spinning reruns.

**codecov/patch reads red on PARTIAL data.** It's computed per upload; before all blackbox shards finish +
upload, `codecov/patch` can show a premature low % (PR #225 saw 33% → 77% → 100% as app then blackbox then
the added unit test landed). Judge patch only after ALL shards are green and codecov recomputes. See
[[project_directus_codecov_flags]], [[reference_reformatting_inflates_patch_coverage]].

**Contention flakes are broader than one file (2026-08-19).** Three *distinct* tests
each failed once and passed on rerun of the identical commit, each on a different
shard, within a few hours: `common/assets/concurrency.test.ts` (autocannon `-c 100`),
`db/routes/items/no-relation.test.ts` (WebSocket subscription `toMatchObject`), and
`db/routes/collections/crud.test.ts` (`Verify schema action hook run`, expected 13 to
be 14). Different test + different shard + green on rerun = the harness.

`vitest.config.ts` sets `poolOptions.forks.maxForks: 6` and the `common` sequential
list is empty, so up to six files run in parallel against one Directus instance on a
4-core runner. `concurrency.test.ts` fires 100 concurrent connections into that and
fails on a single timeout — filed as **issue #367** (options: sequential list, lower
`-c`, or an error budget; plus log the autocannon result when `hasErrors` flips, since
`timeouts` vs `non2xx` is currently parsed and discarded).

Attribution method that worked: iterate the last ~25 runs of the workflow, read the
same job's conclusion, establish the baseline, THEN rerun the identical commit
([[feedback_ci_attribute_via_base_sha]]).

**2026-08-22 (#388): the seed-403 race now has the fallback on structure too.**
`CreateItem` already retried against `getNoCacheUrl` on a 403; `CreateCollection`,
`CreateCollections` and `CreateField` did not — and `CreateField` is where it kept
failing (`test_slice_index_sliced.parent`, 403 FORBIDDEN, twice on the SAME shard, then
`afterAll` tripping on `instance.kill()` of an undefined instance). All three take the
same fallback now. Note the signature: `getNoCacheUrl(vendor)` takes **only** the vendor,
no `env` arg.

Still true that adding blackbox test FILES aggravates the race — #388 added three
collections and that is why it surfaced there. If it recurs on a branch that adds files,
suspect churn before suspecting the diff.

**Fourth signature, 2026-08-25 (#393):** `collections/crud.test.ts > Verify schema action hook run > postgres` — `expected 13 to be 14`. It counts rows in `tests_extensions_log` keyed `action-verify-schema/test_collections_crud*`, so one async hook write had not landed when the read ran. Cleared on a `--failed` rerun with no code change; observed 1 fail in 5 shard runs on that PR. Not the WS/seed-403/EADDRINUSE ones. Second instance supporting the note above that ADDING blackbox test files aggravates these — #393 added two.

**Fifth signature — two files sharing a seeded collection, one of them subscribed
(2026-08-27).** `no-relation.test.ts` opens a WS subscription on the artists collection
and asserts the create event; `batch-insert.test.ts` imports `collectionArtists` from
`no-relation.seed` and writes `batch-N` rows into it. Both ran in the parallel pool, so
`getMessages(1)` returned the other file's row:
`- "name": "one-artist-…"` / `+ "name": "batch-0-…"`. **Red twice running, so not a load
flake** — reruns will not clear it. Fixed by putting the WRITER in the `after` chain.
When a WS assertion sees a plausible row that is not its own, look for a sibling file
importing the same seed, not at the transport.
