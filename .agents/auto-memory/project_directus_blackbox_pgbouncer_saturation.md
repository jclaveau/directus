---
name: project_directus_blackbox_pgbouncer_saturation
description: how to observe a saturated pgbouncer pool from a blackbox test — the probe extension answers before its queries finish, and supertest never sends a request you don't await
metadata:
  type: project
---

Reading live pool state while a pool is saturated (`tests/blackbox/tests/db/app/pgbouncer.test.ts`)
depends on two mechanics that are easy to get backwards — both cost a full CI round trip on #355.

- **`/db-connection-probe/pools-under-load` answers ~400ms in, not when its queries end.**
  `extensions/db-connection-probe/index.mjs` fires `SELECT pg_sleep(n)` per `concurrency`
  **without awaiting** (`.catch(() => {})`), sleeps 400ms so the servers are occupied, runs the
  `probe` list, and returns. So `await` the saturation request — awaiting it *opens* the read
  window; the sleeps keep running for `sleep` seconds after it resolves.
- **supertest requests are lazy.** `const r = request(url).post(...).send(...)` sends nothing
  until `.then()`/`.end()`. Holding one "in flight" without awaiting means it never left.
- **Poll for the state you assert**, don't sleep a guessed interval: read the report in a loop
  (20 × 250ms) until `serversActive > 0`, and hold the queries long enough (12s) that a loaded
  runner lands inside the window.
- **`cl_waiting` is not assertable.** With `query_wait_timeout=1` the queued client gives up
  after a second, so a snapshot rarely catches it. Assert the cumulative counter instead:
  `SHOW STATS.total_wait_time > 0` proves a queue formed, and is monotonic.

The suite spawns two Directus instances (report on / report off) like
`tests/db/app/processes.test.ts` does — `PGBOUNCER_REPORT_ENABLED` is read when
`controllers/utils.ts` is imported, so it cannot be flipped at runtime with `setDirectusEnv`
(the connection list can). Registered in `setup/sequential-tests.ts` (spawns servers) and
`setup/shard-files.ts` (40s). Postgres only — the compose pgbouncer fronts that service alone,
and CI's `Start pgbouncer` step is gated on it.

Related: [[project_directus_db_connection_priority]],
[[project_directus_pgbouncer_admin_console]], [[project_directus_blackbox_sharding]].
