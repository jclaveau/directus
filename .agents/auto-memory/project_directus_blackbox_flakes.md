---
name: project_directus_blackbox_flakes
description: known intermittent blackbox flakes in jclaveau/directus CI (m2o.test.ts WebSocket-OPEN timeout) + how to rerun a failed shard — don't chase these as real bugs
metadata:
  type: project
---

**Tracked as issue #277** — https://github.com/jclaveau/directus/issues/277 ("Flaky: m2o MAX_BATCH_MUTATION 'errors when above limit' (intermittent 200 vs 400) + retry-unsafe mutation tracker"). Cite it instead of re-diagnosing.

**Known intermittent blackbox flake** at `common/transport.ts:333` — two signatures, same seam: `WebSocket failed to achieve the OPEN state` AND `Timeout._onTimeout common/transport.ts:333:21` (a plain transport-request timeout). Both hit `tests/db/routes/items/m2o.test.ts > … MAX_BATCH_MUTATION > createMany > errors when above limit` (all/some of pkType integer/uuid/string).
- **Root cause is the 120s vitest ceiling.** `m2o.test.ts` is huge (1837 tests, ~4282 in the file group) and runs ~116-121 s wall — right against the per-file timeout. Under runner load the last describe's requests time out → 1-3 flakes / 4282. NOT the assertion, NOT your diff (a cache/schema/unit change can't touch the transport). The fix would be sharding m2o.test.ts (out of scope of any feature PR).
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

**Rerun mechanics:**
- `gh run rerun <run-id> --failed -R jclaveau/directus` — reruns only the failed jobs, but ONLY after the
  whole run has completed. Mid-run it's blocked.
- `gh run rerun --job <job-id>` fails with `cannot be rerun` while sibling shards are still in progress.
- Pushing a new commit is a full rerun (all shards) — usually simpler than waiting to rerun one shard.
- If the SAME flake recurs 3+ times, it's a hot flake — flag it for jean rather than spinning reruns.

**codecov/patch reads red on PARTIAL data.** It's computed per upload; before all blackbox shards finish +
upload, `codecov/patch` can show a premature low % (PR #225 saw 33% → 77% → 100% as app then blackbox then
the added unit test landed). Judge patch only after ALL shards are green and codecov recomputes. See
[[project_directus_codecov_flags]], [[reference_reformatting_inflates_patch_coverage]].
