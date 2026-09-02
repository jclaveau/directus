---
name: project_directus_health_holds_on_outstanding_migrations
description: Why /server/health reports error while migrations are outstanding instead of refusing to listen, and the design points already settled on #403/#421
metadata:
  type: project
---

`/server/health` reports `error` (503) while any migration this build ships is missing
from `directus_migrations`. A watch (`api/src/outstanding-migrations.ts`) polls until the
database catches up; `startServer()` starts it, so embedding `createApp` alone is
unaffected.

**It deliberately does NOT block listening.** Railway's healthcheck gates the traffic
switchover, so the 503 already fails a deploy and leaves the previous deployment serving
([[reference_railway_healthcheck_gates_switchover]]). Refusing the port adds nothing
there and would take the service down on any restart landing while migrations are
outstanding — Planner's PM2 `cron_restart` at 03:00, say — with nothing watching to put
it back, since Railway does not probe a live deployment.

- The watch starts **pessimistic**: before its first reading it holds health down, because
  an instance that cannot tell must not report ready.
- It **stops for good on the first clean reading** — the question is about boot. So the red
  state is unreachable from outside on a healthy instance; a test must spawn its own.
- `MIGRATIONS_WAIT_TIMEOUT` (`5m`) bounds the polling, `MIGRATIONS_WAIT_INTERVAL` (`2s`)
  paces it, jittered. Health stays red past the timeout: it ends the polling, not the
  verdict.
- `validateMigrations` kept its signature and both callers; the query moved into
  `outstandingMigrations`, which returns the versions and lets a database error reach the
  caller so the watch can retry. Reading the migrations **directory** stays fatal.

**Settled — do NOT re-raise:** health-red over blocking `listen`; unconditional rather than
opt-in; the watch stopping on first clean read; the `migrations` check being added AFTER
health's logging loop so a red probe does not re-log on every poll.

See [[project_directus_migration_transaction_design]].
