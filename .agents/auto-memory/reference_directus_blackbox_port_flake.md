---
name: reference_directus_blackbox_port_flake
description: bb shard failing with "Port NNNNN is already in use" at server bootstrap = runner port-collision flake, not a code bug; rerun the failed jobs
metadata:
  type: reference
---

A blackbox shard job that fails in the "Run tests" step with `ERROR: Port NNNNN is already in use` (seen: 59202) — thrown while `setup/setup.ts` spawns a Directus server variant (e.g. `Directus-postgres-no-cache`) — is a **runner port-collision FLAKE**, not a test/code failure.

**Tells it's a flake, not a real bug:**
- Fails at BOOTSTRAP (before any test runs) — an "Unhandled Rejection" from the server child process, not an assertion.
- A real api/code bug would fail EVERY shard (same api code boots on all), not one lonely shard. Here pg-shard-4 + sqlite-shard-4 hit it independently = coincidental collision.

**Fix:** `gh run rerun <run-id> --failed` — it clears on rerun.

**Diagnosing:** the job-logs API DROPS the big "Run tests" step output ([[reference_gh_run_tests_log_via_zip]]) — the port-in-use line surfaces in the job log's Unhandled-Rejection tail, or download the run-logs ZIP (post-completion) `N_Run tests.txt`. See [[project_directus_blackbox_sharding]].
