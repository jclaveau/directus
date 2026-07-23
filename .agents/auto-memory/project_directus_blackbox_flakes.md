---
name: project_directus_blackbox_flakes
description: known intermittent blackbox flakes in jclaveau/directus CI (m2o.test.ts WebSocket-OPEN timeout) + how to rerun a failed shard — don't chase these as real bugs
metadata:
  type: project
---

**Known intermittent blackbox flake: `WebSocket failed to achieve the OPEN state`** (`common/transport.ts:333`).
- Surfaces in `tests/db/routes/items/m2o.test.ts` (e.g. `MAX_BATCH_MUTATION > createMany > errors when above
  limit`) — the test harness's realtime WS transport times out establishing the connection, unrelated to the
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
  its shard rather than re-running.

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
