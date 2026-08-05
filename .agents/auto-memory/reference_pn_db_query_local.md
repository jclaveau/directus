---
name: reference_pn_db_query_local
description: Inspect the planner Postgres DB non-interactively via pn db:query:local "<SQL>" (LOCAL docker only). READ-ONLY ONLY — the prod/railway twin (pn db:query:railway) is strictly no-mutation
metadata:
  type: reference
---

From `/home/jean/dev/Hippocast/dev/planner_2/apps/directus` (active planner wt = `planner_2`):

- `./data/db_query_local.sh "<SQL>"` — runs `psql -U postgres -d railway -tAc "<SQL>"` inside the
  `hhh-database` container (docker compose `cd/docker/compose.infra.yaml`). Non-interactive, pipe-friendly,
  one query per call. Use for schema/size/index introspection.
- `pn db:cli:local` — interactive psql session (same container/db). Not for scripted queries.
- DB name defaults to `railway` (`DB_DATABASE` env override).

Calling the `.sh` directly is cleaner than `pn db:query:local` (avoids pnpm arg-passing quirks); the
script cds itself, so invoke with `cd <apps/directus> && ./data/db_query_local.sh "SELECT ..."`.

## PRODUCTION (railway) twin + HARD RULE

- `./data/railway-postgres-cmd.sh ./data/db_query_railway.sh "<SQL>"` (a.k.a. `pn db:query:railway`) runs the
  SAME script against the **PRODUCTION** Railway Postgres of hiphiphip.
- **HARD RULE — ABSOLUTELY NOT ALLOWED: NEVER run ANY mutating query against production.** No UPDATE /
  DELETE / INSERT / DDL / DML / truncate / alter — SELECT-only (or fully read-only CTEs) at most, and even
  SELECTs are still prod data. Production DB access is for inspection/debugging only, never writes.
- Local (`db:query:local`) is the sandbox for any mutation experiments.
