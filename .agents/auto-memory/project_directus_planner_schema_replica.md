---
name: project_directus_planner_schema_replica
description: How to measure against the planner's real schema and extensions without touching jean's database
metadata:
  author: Jean Claveau
  type: project
---

The planner's local database is `railway` in the **`hhh-database`** container (port
5432) — 37 user collections, 327 fields, 95 relations, 115 permissions, 75 tables.
Never boot Directus against it: boot runs migrations, which would mutate it.

The replica, all read-only on jean's side:

```sh
docker exec hhh-database pg_dump -U postgres -d railway --schema-only --no-owner -n public
docker exec hhh-database pg_dump -U postgres -d railway --data-only --no-owner \
  -t public.directus_collections -t public.directus_fields ...   # one -t per table
```

Restore into a throwaway on `blackbox-postgres-1` (port 6100). `-t` takes **one table
per flag**; a space-separated list is swallowed as a single argument.

**Extensions are the harder half.** The planner declares 23, all `source='module'` and
**zero `local`** — copying its `extensions/hooks/` directory registers nothing, and a
"Extensions loaded" line appears either way, so an arm can silently measure nothing.
Load them by running the fork's `dist/cli` with **cwd = the planner app directory**
(`planner_2/apps/directus`) and `CONFIG_PATH` pointing at your own env file, which is
what keeps the database throwaway. That loads 9. A synthetic root (a `package.json`
declaring a subset, `node_modules` symlinked to the planner's) isolates one extension,
but silently drops `prometheus` and `schema-sync` — trust the real directory's number.

**How to apply:** verify the arm varied by counting rows in `directus_extensions`, not
by reading the log. See [[project_directus_boot_cost_shape]] and
[[reference_pn_db_query_local]].
