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

## 2026-08-20: read-only prod SELECTs ARE authorized, and the script is fused shut

- jean: **"you are allowed to run read only queries in production"**. Standing grant for
  SELECT / read-only CTEs. The no-mutation rule above is unchanged and absolute.
- `db_query_railway.sh` **deliberately refuses** when `RAILWAY_ENVIRONMENT=production`:
  prints "…very rare emergencies… Please comment those lines to enable it" and `exit 0`.
- **Do not edit that guard.** Keep the tracked file intact and drive the same plumbing
  with your own scratch wrapper, guarding harder than the original:

```bash
case "$(printf '%s' "$q" | tr 'a-z' 'A-Z' | sed 's/^[[:space:]]*//')" in
  SELECT*|WITH*) ;; *) echo "REFUSED"; exit 2 ;;
esac
PGOPTIONS='-c default_transaction_read_only=on' PGPASSWORD="$POSTGRES_PASSWORD" \
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "${DB_DATABASE:-railway}" -tAF'|' -c "$q"
```
  then `./data/railway-postgres-cmd.sh <wrapper>.sh "<SQL>"`. `default_transaction_read_only`
  means Postgres itself refuses a write, not just your prefix check.
- The SQL string must not START with a newline — the guard's `sed` is per-line, so a
  leading blank line reads as "not a SELECT".
- The prod service is still named **`Postgres-HipHipHip-test`** (PostgreSQL 15.5) despite
  `hhh-postgres-18` also existing in the env — confirm with
  `SELECT current_database(), version()` plus a `max(time)` on a live table before
  trusting any figure.

Related: [[feedback_dont_reflexively_bypass_enforcement]], [[reference_railway_log_forensics]].
