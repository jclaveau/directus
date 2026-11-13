---
name: project_directus_blackbox_flows_seed_server
description: bb seeds run against the no-cache server (PORT+50), so a seeded event flow is never registered on the cache server the scenarios hit
metadata:
  type: project
---

Each bb vendor runs TWO servers: cache (PORT) and no-cache (PORT+50). `seed-database.test.ts` calls `DisableTestCachingSetup()`, which sets `TEST_NO_CACHE`, so a `seedDBStructure` `getUrl(vendor)` resolves to the no-cache one. The scenarios run against the cache one.

A flow registers only on a `flowManager.reload()`, and the reload travels over the bb bus, which is in-process, never across the two. So the flows a seed writes are live on the no-cache server only, and on the cache server no event flow runs: `expected []`, and a refusal filter answers 200.

Found 2026-10-08 on PR #387 (`event-flow-runs`, all 6 scenarios red). The tell: the shard's `blackbox-server-logs-*` artifact shows `POST /flows` only in `server-log-postgres-no-cache.txt`.

Fix (commit a5dd1b09f6): in the test file's `beforeAll`, do `PATCH /flows {keys, data:{status:'active'}}` against `getUrl(vendor)`. Then poll a probe row on the refusal-filter collection until it answers 400. The reload lands after the response, so the probe is the positive witness.

Related: [[project_directus_blackbox_seed_mechanics]], [[project_directus_pr387_update_groups]].
