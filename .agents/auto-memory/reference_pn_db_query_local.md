---
name: reference_pn_db_query_local
description: Inspect the planner Postgres DB non-interactively via pn db:query:local "<SQL>"
metadata:
  type: reference
---

From `/home/jean/dev/Hippocast/dev/planner/apps/directus`:

- `./data/db_query_local.sh "<SQL>"` — runs `psql -U postgres -d railway -tAc "<SQL>"` inside the
  `hhh-database` container (docker compose `cd/docker/compose.infra.yaml`). Non-interactive, pipe-friendly,
  one query per call. Use for schema/size/index introspection.
- `pn db:cli:local` — interactive psql session (same container/db). Not for scripted queries.
- DB name defaults to `railway` (`DB_DATABASE` env override).

Calling the `.sh` directly is cleaner than `pn db:query:local` (avoids pnpm arg-passing quirks); the
script cds itself, so invoke with `cd <apps/directus> && ./data/db_query_local.sh "SELECT ..."`.
