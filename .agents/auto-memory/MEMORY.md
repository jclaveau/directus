Memory index — a router, not a catalogue. Each heading names a category, the
number of memories it really holds, and the index file listing all of them. The
lines under it are only the handful that come up most often.

Most memories are reachable ONLY from a category's index file, so whenever a task
touches an area, read that file before concluding no rule exists. A new memory
gets its line in the category's index file and bumps the count here, never a
line appended below.

## process (21) — how to work in this repo: tests, CI asks, review routing
`.agents/auto-memory/index/process.md`

- [Run every test in CI, loop on the run](feedback_directus_ci_only_test_runs.md) — unit, typecheck, blackbox all in CI; no local vitest/tsc gate
- [Never run blackbox locally](feedback_directus_bb_tests_in_ci.md) — slower than CI's shards and re-seeds jean's docker stack
- [No consumer data in fork memories](feedback_directus_no_consumer_data_in_fork_memories.md) — public repo: consumer specifics go to its private repo; a consumer prod DB is SELECT-only
- [Non-PG review points go to #610](feedback_directus_non_pg_review_points_to_610.md) — sqlite/cockroach/maria finding → point in #610 + `TODO(#610):`, never fixed in the PR
- [Postgres only in the main workflow](feedback_directus_pg_only_dialect_focus.md) — no MariaDB/SQLite investment; never report their absence as a gap
- [CI-triggering action needs its own approval](feedback_ci_trigger_needs_own_approval.md) — label/dispatch/rerun is its own ask
- [The admin preview is not a CI check](feedback_directus_ci_watch_skip_preview.md) — never wait on it, never mention it in a CI report
- [New bb files are Gherkin](feedback_directus_blackbox_gherkin_standard.md) — `.feature` + step `.test.ts`

## settled (29) — per-PR accepted exceptions; read before reviewing that PR
`.agents/auto-memory/index/settled.md`

- [PR #607 accepted exceptions](project_directus_pr607_accepted_exceptions.md) — context.transaction on mutation filters; non-PG → #610
- [PR #605 row-helpers](project_directus_pr605_row_helpers.md) — mapUpdateRows/mapCreateRows replace `.one` events
- [PR #600 query-audit header](project_directus_pr600_query_audit.md) — counts in knex `_query`; ONE map header

## scoped-cache (18) — tag derivation, pins, purges, value slices
`.agents/auto-memory/index/scoped-cache.md`

- [Scoped cache tag derivation](project_directus_scoped_cache_tag_derivation.md) — what a read gets tagged with; only stale vector = enrichment outside the AST
- [Scoped-cache pin soundness](project_directus_scoped_cache_pin_soundness.md) — subset invariant + the two shapes that break a key pin
- [scopedCache hook API](reference_directus_scopedcache_api.md) — scopeTo/dependOn on reads, purgeBy on mutations
- [Query-filter $NOW is NOT a cache poison](reference_directus_query_now_not_cache_poison.md) — mis-analysed ≥2×; keys differ per request

## cache (29) — tiers, namespaces, keys, telemetry, audit, admin page, Redis
`.agents/auto-memory/index/cache.md`

- [Cache key identities](project_directus_cache_key_identities.md) — cacheKey digest vs redisKey; a wrong one fails SILENTLY as a cold cache
- [Cache layers fail differently](project_directus_cache_failure_semantics.md) — ioredis raises, Keyv swallows, bus fire-and-forget
- [Cache tier switches](project_directus_cache_tier_switches.md) — only response+schema switchable

## blackbox (24) — seeds, sharding, flakes, spawned instances
`.agents/auto-memory/index/blackbox.md`

- [Directus blackbox run + logs](project_directus_blackbox_run_and_logs.md) — bb runs on every code PR; the label is NOT required and cancels the run
- [Blackbox flakes](project_directus_blackbox_flakes.md) — known intermittents; `gh run rerun --failed` only after the run completes (needs its own ask)
- [Isolate new blackbox fixtures](project_directus_bb_fixture_isolation.md) — `fields=*` splices every alias; new scenarios get own collections
- [bb pins its own toolchain](reference_directus_blackbox_pins_own_toolchain.md) — CI resolved vitest 4.1.11; check the run log before relying on `expect.poll`

## ci (19) — workflows, codecov, lint gates, bench, preview
`.agents/auto-memory/index/ci.md`

- [Two eslint configs](project_directus_two_eslint_configs.md) — Lint vs Style (changes); run both before push
- [The blocking codecov check is the unflagged patch at 95%](project_directus_codecov_aggregate_patch_gate.md) — only unit tests clear the bar
- [Bench measures the trunk, not your PR](project_directus_bench_measures_trunk.md) — a red `Bench / cache` on a PR is the trunk tip

## unit-tests (8) — vitest mocks, typecheck, local test env
`.agents/auto-memory/index/unit-tests.md`

- [knex-mock matches raw SQL](reference_directus_knex_mock_sql_matching.md) — register the narrower handler first
- [useEnv mock needs vi.hoisted](reference_directus_useenv_mock_hoisted.md) — automock evals the real module first

## api (32) — Directus core internals, env, errors, migrations, DB
`.agents/auto-memory/index/api.md`

- [A bad env var fails the boot](feedback_directus_bad_env_var_fails_boot.md) — exit before listen naming the var; never fall back
- [Env TYPE_MAP coverage](project_directus_env_type_map.md) — register every env var you touch
- [Directus ForbiddenError conventions](project_directus_forbidden_error_conventions.md) — 403 for missing items, pre-access validation 400

## processes (28) — pm2, autoscaler, boot cost, worker RAM
`.agents/auto-memory/index/processes.md`

- [processes/autoscale consolidation](project_directus_processes_autoscale_consolidation.md) — one bounded `processes/supervisor/` gateway; routes/env frozen
- [RAM: the node flags that work](project_directus_ram_node_flags.md) — never cap old space without a measured peak

## fork (18) — branches, PR naming, licensing, derived branches, worktrees
`.agents/auto-memory/index/fork.md`

- [New feats base on v11.10.1-hhh-dev](feedback_directus_new_feat_base_hhh_dev.md) — fetch + sync hhh-dev first
- [Derived branches regenerate themselves](project_scalabus_derived_branches.md) — never hand-edit `*-dist` / `ci-dialect-*`
- [Worktrees share the main tree's node_modules](project_directus_worktree_shared_node_modules.md) — cross-package tests resolve from the main tree's branch

## app (3) — Vue dashboard component quirks
`.agents/auto-memory/index/app.md`
