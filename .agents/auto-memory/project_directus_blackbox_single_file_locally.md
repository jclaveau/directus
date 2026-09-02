---
name: project_directus_blackbox_single_file_locally
description: how to run ONE blackbox file locally without the run hanging forever — the completion barrier, the --shard flag the sequencer needs, and why the before-files must run
metadata:
  type: project
---

Running a single bb file (`pnpm --filter tests-blackbox test --project db <name>`)
hangs with no output. Three separate traps, each costing a full attempt:

1. **The completion barrier.** `setup/environment.ts` blocks until
   `tests_flow_completed` holds at least `getReversedTestIndex(...)` rows, which for a
   file in neither list is `sequentialTestsList.db.before.length` (6). Filtered out,
   those files never run and the wait never ends. Vitest reports NOTHING while it
   spins — the log stops after `✔ Test server connectivity`.
2. **`files.length > 1` turns on validation.** `setup/sequencer.ts` throws
   `Non-existent test file "…" in "after" list` once more than one file is selected —
   unless `ctx.config.shard` is set. Pass **`--shard=1/1`** (plus `SHARD_INDEX=1
   SHARD_COUNT=1`) and missing sequential files are tolerated.
3. **The admin token comes from the seed.** Without `seed-database.test.ts`,
   `USER.ADMIN.TOKEN` is invalid, every request 403s, and the symptom is
   `x-cache-status` being `undefined` rather than an auth error.

**Recipe that works:** `TEST_DB=postgres SHARD_INDEX=1 SHARD_COUNT=1 pnpm --filter
tests-blackbox test --project db --shard=1/1 seed-database common/common.test
routes/schema/schema.test routes/collections/crud routes/fields/change-fields
routes/fields/crud <your-file>` — about 8 min, seed-database alone is 2-4 of them.

Needs `docker compose -f tests/blackbox/docker-compose.yml up postgres redis minio
minio-mc auth-saml -d` (redis on 6108, postgres on 6100) and a built `dist`
(`pnpm build && rm -rf dist && pnpm --filter directus deploy --legacy --prod dist`).
**Global setup re-bootstraps the DB**, so anything you insert before launching is wiped.

Related: [[project_directus_blackbox_cache_local_repro]] (single hand-run server,
cheaper when you do not need the harness), [[project_directus_blackbox_sharding]].
