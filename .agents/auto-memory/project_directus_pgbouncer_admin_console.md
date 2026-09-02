---
name: project_directus_pgbouncer_admin_console
description: PR #355 Settings → PgBouncer page — how the admin console has to be talked to, what its SHOW output really means, and the settled design decisions
metadata:
  type: project
---

Settings → **PgBouncer** (`app/src/modules/settings/routes/pgbouncer/`, api `api/src/pgbouncer/`),
PR **#355**, branch `v11.10.1-feat/admin-pgbouncer-page` (base `v11.10.1-hhh-dev`, worktree
`deps/.wt-pgbouncer`). Third live-state page beside Cache and Processes; reads each pooler's
admin console over `GET /utils/pgbouncer?details=pools,stats,limits,clients,servers`.

**knex CANNOT talk to the pgbouncer admin console.** Its pg dialect issues `select version();`
on every new connection; the console answers
`invalid command 'select version();', use SHOW HELP;` and every query on that pool then fails.
Use a bare `pg.Client` (memoized per `host:port`, dropped on a failed read). Both simple and
extended protocol work from node-postgres — the protocol is not the problem, knex's probe is.

**Bundling `pg` kills the api at boot.** rolldown follows `import pg from 'pg'` into
`pg/lib/native/client.js`, whose top-level `require('pg-native')` runs on load — pg-native is
optional and not installed → `MODULE_NOT_FOUND`, every blackbox shard dead at
`directus bootstrap`. Fixed by `external: [..., /^pg(-native)?$/]` in `api/tsdown.config.ts`.
knex never hit this because it resolves drivers by name at runtime. Reproduce locally with
`pnpm --filter @directus/api build && node dist/cli/run.js bootstrap` against a real DB —
that step alone catches it.

**SHOW output gotchas (verified against edoburu/pgbouncer 1.25.2):**
- `SHOW POOLS` names the pool `database`; `SHOW DATABASES` names it `name` and keeps
  `database` for the server-side database it forwards to. Filtering both on `database` lets
  the admin entry through as a phantom pool.
- `SHOW POOLS` lists a database only once it has been used → `SHOW DATABASES` is the spine, so
  a configured-but-idle tier shows idle rather than missing.
- int8 columns (`total_*`) come back as **strings**; int4 as numbers.
- Durations are split: `maxwait`/`maxwait_us`, `wait`/`wait_us` = whole seconds + microsecond
  part.
- `SHOW CLIENTS.wait` is NOT the queue wait the docs claim — an *active* client reports how
  long its query has been running (measured 1.48s on a running `pg_sleep`).
- `SHOW CONFIG` carries **no credentials** (only file paths + `auth_query`), so redaction is a
  scope call, not a security one. The page ships ~10 curated keys, not all 98.
- `pool_size: 0` means "inherits `default_pool_size`", not "no capacity" → report `null`.

**Settled decisions — a fresh review should NOT re-raise:**
- Env prefix `PGBOUNCER_*` (jean's pick over `DB_POOLERS_`/"Poolers"), page scoped to pgbouncer.
  Being outside `DB_` also dodges the `getBaseDbConfig()` leak that bit `DB_PUBLIC_SHARE_CONNECTION_NAME`.
- Instances **derived from the connection registry** (`PGBOUNCER_CONNECTIONS` names DB
  connections; their host/port is the console), folded by `host:port`. No parallel registry.
- HA: `PGBOUNCER_<CONN>_ADMIN_HOSTS` lists members, each read as its own instance (counters are
  per process and share nothing).
- No persistence — the chart is an in-page ring buffer; a `directus_pgbouncer_samples`
  hypertable would be its own PR.
- Rates come from pgbouncer's own `avg_*` (its last stats period), not a delta between polls,
  so the user's refresh interval can't change what a rate means.
- Postgres-only by design; a non-pg connection in `PGBOUNCER_CONNECTIONS` fails at boot. See
  [[project_directus_db_connection_priority]] for why mariadb/sqlite have no analog.
- Read-only: no PAUSE/RESUME/RECONNECT.
- `assertPgBouncerConnections()` is called from `app.ts`, not `getDatabase()`, to avoid a
  database→pgbouncer import cycle.

**`application_name` stamping (same PR).** Every pg pool is built with
`application_name = directus:<nodeId>:<connection>` (`constructDatabase(config, name)`), so a
`SHOW CLIENTS` row names the replica and the tier — and the `nodeId` is the same
`api/src/utils/node-id.ts` nanoid the logs stream and processes report use, so a pooler client
joins to a row of Settings → Processes. `DB_APPLICATION_NAME` resolves camelCased
(`getConfigFromEnv`), which the driver never reads; it is now forwarded under
`application_name`.

Related: [[project_directus_cache_admin_page]], [[project_directus_db_connection_priority]],
[[project_directus_blackbox_pgbouncer_saturation]].
