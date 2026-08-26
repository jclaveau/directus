---
name: project_directus_prod_db_access
description: how to reach the HipHipHip prod Postgres and Redis from the laptop (railway link -w/-p/-e, then railway run -s <service> -- psql/redis-cli), and the traps in getting there
metadata:
  type: project
---

**psql against prod Postgres**, from any directory (link state is per-cwd, so do it
in a scratch dir, not the repo):

```sh
railway link -w HipHipHip -p HipHipHip -e production   # -e is REQUIRED non-interactively
railway run -s Postgres-HipHipHip-test -- psql -f diag.sql
railway run -s Redis -- sh -c 'redis-cli -u "$REDIS_URL" exists "<key>"'
```

**Why it works:** `railway run` executes LOCALLY with the service's env injected
([[reference_railway_run_is_local]]), and those services expose `PGHOST`/`PGPORT`
(`monorail.proxy.rlwy.net`) and `REDIS_URL` pointing at the public TCP proxy — so
psql/redis-cli on the laptop connect straight through. `railway ssh` is
classifier-blocked; do not reach for it.

**Traps:**
- `railway link` without `-e` fails with *"--environment required in non-interactive
  mode"* and leaves nothing linked.
- The prod DB service is **`Postgres-HipHipHip-test`** (the `-test` suffix is a
  historical name, it is production). `hhh-postgres-18` and `Postgres-HipHipHip-17`
  also exist — check `RAILWAY_VOLUME_NAME`/`railway status` before trusting one.
- `redis-cli --scan --pattern '*<hash>*'` over the whole keyspace does not finish in
  a tool timeout; `exists` on a constructed key answers instantly.
- Put the SQL in a file and use `psql -f`; multi-statement `-c` strings and
  heredocs fight the shell ([[feedback_remote_python_via_ssh_stdin]] is the same
  lesson elsewhere).

Related: [[reference_railway_log_forensics]], [[reference_railway_variable_references]].
