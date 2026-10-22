---
name: project_directus_blackbox_flakes
description: known intermittent blackbox flakes in jclaveau/directus CI (m2o.test.ts WebSocket-OPEN timeout) + how to rerun a failed shard — rerun, then root-cause it in a dedicated PR merged first (feedback_directus_flakes_get_dedicated_pr)
metadata:
  author: Jean Claveau
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

**Sixth signature — `app/autoscale-churn.test.ts` instance-count race (2026-09-23,
PR #534 shard 4).** `holds a churning pool at the ceiling instead of releasing it`:
`expected [ 2, 1 ] to deeply equal [ 2 ]` — the assertion records the DISTINCT instance
counts pm2 reports in order, and a transient `1` slipped in while the pool was on its way
back to 2 (supervisor logged `0:online:0%, 1:online:0%` at the moment of the read). 414 of
415 tests in the shard passed; `gh run rerun <run> --failed` cleared it with no code change.
Nothing to do with the diff under test — a scoped-cache/comment-only branch cannot move the
autoscaler.

**Seventh signature — `app/deployment-namespace.test.ts` MONITOR connection
(2026-09-23, PR #534 shard 6).** `beforeAll` calls `redis.monitor()` on the Redis every
suite of the shard shares, so a shard-mate's traffic lands on that connection and ioredis
throws `Error: Command queue state error` with `Last reply: … "publish"
"blackbox-prewarm-load-postgres:bus:logs"`. The suite aborts mid-`beforeAll`, so `afterAll`
then trips on `TypeError: Cannot read properties of undefined (reading 'kill')` at
`instances[vendor]!.kill()` — that second error is the symptom, not the cause. 402 of 405
passed; `gh run rerun <run> --failed` cleared it. The file is old and untouched by the
branch it fails on.

**Eighth signature — an unasserted seed write read back much later (2026-09-23, PR #534
shard 5).** `cache-o2m-and-m2o-same-collection.test.ts:159` failed with `TypeError: Cannot
read properties of null (reading 'body')` on `after.body.data.featured_comment.body`, while
the cache assertion on the same read (MISS) passed. The M2O value is set by a raw supertest
PATCH in `beforeAll` whose status nothing checked, so a seed write that did not land reads
as a cache bug 100 lines away. Cleared on rerun; the seed now carries `.expect(200)`. A raw
`request(...)` in a seed needs `.expect(200)` — the `Create*` helpers already throw on
non-2xx ([[project_directus_blackbox_silent_write_failures]]).
**Sixth signature — two suites claiming the same migration version on the shared
vendor DB (2026-09-08, PR #456).** `migration-transaction.test.ts` applies
`20990101A` and only removes it in its own `afterAll`; `health-outstanding-migrations
.test.ts` staged a file with that exact same version and expected it outstanding. A
shard that packs them side by side boots the health instance against a DB that already
recorded the migration it was meant to be missing — all three assertions failed, not
partially, because the watch reads clean and health never even holds. Latent until a
`shard-files.ts` repack happened to place them together. Fix: pick a version number
nobody else claims (`20991231A`) and leave a comment on the file naming the collision,
so the next person picking a number reads it first. General lesson: a fabricated
migration version string is effectively global state on the shared vendor DB, same
class as a collection name — check for existing users before picking one.

**Eighth signature — twice-red is not a flake (2026-09-15, PR #494's shard 7).**
`autoscale-mcp-levers.test.ts` failed identically on a run AND its `--failed`
rerun (0/2) — the tell that ended the "flake, rerun it" reflex and started a
root-cause hunt instead. Real bug: an ioredis subscribe-during-connect race
silently and permanently drops a bus subscription; PR #492 reordered boot-time
imports just enough to land a subscribe inside the ~1-2ms losing window. Full
mechanism, probe, and fix in
[[project_directus_bus_subscribe_race_pr497]]. General rule this confirms:
**2+ identical reruns red on the SAME arms ⇒ stop rerunning, diagnose** — a
single red-then-green is the load-flake shape documented above, a red-then-red
on the same test is not.

**Seventh signature — `autoscale-config-source` hold arm, still unretired (PR #456).**
3 failures in 5 runs (`:76`, `:115`, `:121`), shape always `[1, 2]` (pool grew when the
arm expected it to hold). Two theories tested and refuted: boot-CPU-is-cumulative
(raised warm-up 2→8, failed again) and runner-CPU-contention (saturated all 8 local
cores, didn't reproduce either way). Stopped guessing a third time and instrumented the
assertion with `{sizes, decisions, restarts}` instead — passed twice after that, so no
data was captured, and it is NOT to be called retired on green streaks alone. See
[[project_directus_pr456_open_items]] for what each shape of a future recurrence would
mean.

**Ninth signature — a spawned instance on its own namespace misses schema changes
(2026-09-29, PR #572).** `cache-content-version` got `POST /users 500` with PG `42P01
relation "users_me_nested_student" does not exist`. `users/cache-nested-relation-tags`
adds an o2m alias to `directus_users` and drops it in `afterAll`; since #503 the bus
follows `CACHE_NAMESPACE`, so an instance on another namespace never hears
`schemaChanged` and keeps the dead alias. Fix: the file that mutates a SYSTEM
collection goes in the serial `after` list. Any spawned instance is exposed, so
suspect this whenever a 500 names a table another file owns. The spawned instance's
log is only visible because content-version now saves it under `TEST_SAVE_LOGS`.

**Same day, still open:** `cache-audit-under-pressure` got 200 where a 503 was
expected (limiter sampled at 1000ms, timing-decided precondition), filed as **#580**;
`graphql-ip-gated-read` got `Cannot query field "ip_gated"` (a validation error, not
the expected permission refusal), 1 occurrence, not filed.

**2026-10-09: `graphql-ip-gated-read` root-caused, fixed on PR #602 (merged 2026-10-09 as 68832078de).** A sibling file's write (any collection/field/relation/user/role/policy/permission/access write → `clearSystemCache` → `schemaChanged`) empties the per-user GraphQL schema cache between the given-step read (cached under `scope_type_role_user`, no IP in key) and the outside-range read, which then builds a schema without `ip_gated`. Over websocket graphql-ws 6.2 throws the validation error from `iterate().next()`, so a result-checking retry never sees it (why #590's retry missed it). Fix = file moved to the serial `after` list in `tests/blackbox/setup/sequential-tests.ts`, retry removed; CodeRabbit's "restore the retry" declined in-thread. Proof is only the green CI run (never reproduced). Open product question for jean: schema content depends on request IP (`fetchAllowedFieldMap` honours `ip_access`) but the cache key has none.
Also in #602: app `autoscale-panel.vue.test.ts` countdown flake = test read `ceil((until-Date.now())/1000)` on the real clock; fixed with `vi.useFakeTimers({toFake:['Date']})` (flushPromises needs real timers). The `s%` in `.text()` is the two v-input suffixes, not a component bug. See [[feedback_directus_flakes_get_dedicated_pr]].

## #602 review findings + MONITOR-noise flake (2026-10-09)

- A bb file moved into the serial `after` list needs a `DURATION_HINTS_MS` entry in `tests/blackbox/setup/shard-files.ts`; without one the planner reads source bytes as ms (8197 B → 8.2 s vs 2.9 s real) and inflates that shard's serial floor.
- `vi.useFakeTimers({ toFake: ['Date'] })` freezes `Date` only: a component interval that disarms on `Date.now() >= deadline` then NEVER disarms (leaks until worker exit). Unmount the panel in `afterEach` (CodeRabbit caught it; fixed 815a7e5fbd).
- `cache-purge-redis-commands.test.ts` "same commands whatever other values are cached": expected 15 got 18. Extra is always `get`×4, `set`×4, `publish`×4, no key, un-namespaced (4 occurrences across runs) = periodic burst from another client seen by the MONITOR capture. Suspect: metrics redis check (`metrics-<id>`) or process reporting. jean ruled: fix it inside #602 (the flakes-gathering PR).

## #602 flake survey + root causes (2026-10-09, 1249 Check runs since 09-18)

Ranked (failed jobs): graphql-ip-gated-read 37 (fixed #602), autoscale-churn 25 (pool released 2→1; hyp: crash→restart gap > `WARMUP_SECONDS` 5), cache-audit-under-pressure 19 (`expected 200 to be 503`, limiter sampling window; #580), cache-audit cron-run-missing 16 (last 09-30), fingerprint-index-race 16, cache-purge-redis-commands 8 (fixed #602), 42703 seed race 10 (last 10-01, #590), websocket "Hook timed out" 9, setnull-delete 6, retry-timer 6, db-connection-priority 4. Exclude from any survey: `ci-dialect-*` (deterministic maria/sqlite red), `v11.10.1-scratch/*` revert-proof branches (their red is intended), branch-local diff reds.

- **`cache-purge-fingerprint-index-race` = TEST bug, not stale cache.** Decoys sat in the same Redis set as the held reads; the purge SSCANs it and a member added mid-pass survives only if the cursor already passed its hash slot (random per Redis process) → ~5% of tests had 0 survivors → "aim missed" guard. The `HIT×5` failures all came from scratch revert-proof branches. Fix: plant decoys in the BARE collection set (`scopedCacheRowIndexKeys` reads bare + slot sets in parallel; the held set is empty and read whole on page 1). Commit `be95ff8418`.
- **`cache-declared-pin` Background `reading 'filter'` = PRODUCT bug in `@directus/schema` postgres.ts.** `columnInfo()` (no table) constraints query calls `pg_get_serial_sequence(att.attrelid::regclass::text, …)`: rows come from the statement snapshot, the regclass lookup from the CURRENT catalog, so a sibling's `DROP TABLE` mid-statement yields `relation "<oid>" does not exist` (42P01) → `/fields` 500 → unchecked `.data.filter`. Only the first (cold) `/fields` per instance is exposed (CACHE_SCHEMA). Fix: replace with an `EXISTS` over `pg_depend`/`pg_class relkind 'S'`; stress 166/602 reads failed → 0/510. Not caused by #602 (admin path never reads the permissions cache).
- **Test-only fixes need a red proof, and bb runs only on PR events**: push a scratch commit to the PR that re-breaks the product, watch it go red, then force-push it away. A deterministic proof (REPEATABLE READ snapshot + drop from a second connection) beats timing.
- **Unchecked status hides the real error**: bb helpers reading `.body.data` must assert `statusCode` with the body as message (`expect(res.statusCode, JSON.stringify(res.body)).toBe(200)`).

## #602 flakes B + E, red-proof results (2026-10-09, later)

- **`cache-audit-under-pressure` `expected 200 to be 503` = TEST bug (not the sampling clock).** `packages/pressure/src/monitor.ts` compares the mean of a 10ms event-loop-delay histogram against `MAX_EVENT_LOOP_DELAY=100`. A 300ms stall = one sample ~300, each free 10ms = one sample ~10. Serial priming (`for … await read`) leaves a full round trip between stalls; simulated mean: gap 30ms → 110-123 (sheds), 40ms → 92 (no shed), identical at every sampling offset. So idle gap > ~35ms on a loaded runner defeats the precondition. Fix: send the 8 primes with `Promise.all` so stalls queue back to back. Deterministic red: the stall hook awaits `setTimeout(60)` before `Atomics.wait` (extension `tests/blackbox/extensions/cache-audit-stall/index.mjs`). Supersedes the "#580 sampling window" theory.
- **Same file, `scanned 8 / fresh 8` mismatch** = unfiltered `POST /utils/cache/audit` from another `CACHE_NAMESPACE` retiring the shared descriptor rows (`retireCacheAuditQueue`, `api/src/cache-events.ts`); already fixed by `dead96ffa7`. Check `git merge-base --is-ancestor` of the failing job sha before diagnosing. Design weakness left for jean: DB-wide queue retired by a per-namespace view (needs a namespace column on descriptors).
- **`autoscale-churn` (A)**: `sizesOver` is fooled by pm2 listing a crashed worker as `stopped` until `restart_delay` fires; assert on `decisionAfter` (every release logs `N -> M workers:` first) plus an `autoscaler running;` liveness guard. `autoscale-config-source` still uses `sizesOver` (:134, :218), possibly same dip.
- **Cache-audit schedule (E)**: test read the run's results before the scheduled run finished; wait for its own finished row, always clear the rule in cleanup.
- **Red-proof result (run 37902165057)**: all five targets went red for the predicted reason (A real `2 -> 1`, B 200≠503, C under scratch `del`, D without the schema fix, E both schedule tests). Scratch commit's collateral reds (unit api cache) come from the mutation itself. Backup branch kept as `flakes-scratch-bk`.
- **Still open**: B's fix timed out at 60s in one shard on the fix head (66a1aa544c); pool-deadlock guess weak (reads don't run in a transaction). Method chosen: scratch instrumentation commit capturing the spawned instance's output + per-phase timestamps, not more guessing. Unexplained B jobs: 109140970115 (`scanned 0` ×30 with dead96ffa7 present), 111185358859 (`MISS`≠`HIT` :150), 112815617871 (60s).
- Tooling: zsh does not word-split a `$C` alias var (use a function or spell it out).

## #603 flakes round 2 (2026-10-09)

- **"Hook timed out in 600000ms" on the `after` files = gate deadlock, PROVEN.** Completion to `tests_flow_completed` was posted from `setup/sequential-gate.ts` `afterAll`; vitest 4.1.11 runs NO hook (setup-file hooks included) for a fully-skipped file or a file that fails to load → that file never reports → every `after` file waits 600 s. Causes seen: db-connection-priority fully skipped on sqlite3/maria (22 jobs), collect failure on a branch (12, the wall of timeouts hides the real error), one 605 s middle file. Red test `tests/common/harness/sequential-gate-completion.feature` (spawns vitest on 3 fixtures vs a fake completion server), job 113763133609. Fix `abf46f5f73`: `setup/completion-reporter.ts` `onTestModuleEnd` (main process, every module) posts it; `afterAll` gone. When a timeout wall appears now, look for the file that skipped/failed to collect.
- **`cache-purge-retry-timer` `expected [ { id } ] to deeply equal []` = test race.** Drain (`api/src/scoped-cache/purge.ts` ~1326) purges then deletes the pending record in a separate statement, so a read sees the MISS first. Deterministic red: second connection `FOR UPDATE` on the record rows, commit 3 s after the MISS (job 113766478523). Fix `084f862f53`: poll the record.
- **`setnull-delete`**: fixed by `ab479b4ffc` before #603, no longer open.
- **db-connection-priority (4 jobs, old branches)**: A `expected 200 to be 429` probably cold-connect (pre-warm pool + poll `numUsed()` instead of `setTimeout 400` in `extensions/db-connection-probe/index.mjs`), INFERRED; B `expected 500 to be 429` = "Connection terminated unexpectedly" has no code → not matched by `getPoolExhaustedError` (`api/src/database/errors/dialects/postgres.ts`), product gap, mechanism a GUESS (needs pgbouncer verbose logging).
- `cache-audit-under-pressure` `expected 200 to be 503` recurred AFTER #602's Promise.all fix (job 113766478459, 4164 ms) → investigated in #603.
- **under-pressure `200≠503` root cause (red job 113779593760, fix `1de283cf4a`, 8 shards green)**: `packages/pressure/src/monitor.ts` reads `histogram.mean` once per tick, sample-count weighted. 8 concurrent `await setTimeout(60)` + `Atomics.wait(300)` stalls run in ONE timers phase → one ~2400 ms sample, diluted by idle samples to <100 → ping 200. Fix: chain each stall on its own `setTimeout(0)` turn (drop `IDLE_GAP_MS`); red = barrier releases the 8 together after a 1100 ms phase-pinning stall + 600 ms idle; hook gets the read count via the flag (`together:N`), no copied const. Upstream side finding, unfixed: `eventLoopUtilization()` called without arg = cumulative, ceiling never trips. Proved in a standalone sim of the monitor BEFORE pushing the red.
- **`api/src/utils/stall.test.ts` flake (`0≠1`, then `2≠1`)**: `vi.useFakeTimers()` with no `toFake` also fakes `performance` (vitest 4.1.11) → `vi.spyOn(performance,'now')` mocks the fake while `stall()` reads real `node:perf_hooks`; outcome depends on worker uptime R (<100 ms = CI pattern, ≥1100 ms = other failure). NOT a cross-file leak (pool forks, isolate). Red `28481d36d1` busy-waits `beforeAll` past 1100 ms; fix `e96dda8ab6` `toFake: ['setTimeout','clearTimeout']`.
- **#603 deep-review findings (fixed in the loop)**: completion-reporter retry can double-post after a 10 s axios timeout on a POST the server saved (gate counts rows, `test_file_path` not unique) → look the row up before retrying; `FOR UPDATE` hold in retry-timer stalls other instances' retries (pending-purge list not namespaced) → hold 3 s→500 ms; `finally{commit()}` must not mask the assertion error; restore the `performance.now` spy.
- Method that worked: read-only subagents mine logs, then I re-verify the claimed mechanism (sim / grep vitest dist) before building the red.
