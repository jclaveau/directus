---
name: project_directus_prod_db_access
description: how to reach the HipHipHip prod Postgres and Redis from the laptop (railway link -w/-p/-e, then railway run -s <service> -- psql/redis-cli), and the traps in getting there
metadata:
  author: Jean Claveau
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
psql/redis-cli on the laptop connect straight through.

**Prod's TCP proxy gets removed and re-added.** When it is gone the tell is
`PGHOST`/`PGPORT` resolving **empty** (the variables still exist — they are references to
`RAILWAY_TCP_PROXY_DOMAIN`/`_PORT`, which survive the proxy's deletion as dangling
pointers), `DATABASE_URL` with an empty host, and
`railway connect Postgres-HipHipHip-test` answering *"No supported database found in
service"*. Re-add it in the UI: service → Settings → Networking → TCP Proxy, port 5432.

**That re-add does NOT redeploy Postgres** — jean verified on dev 2026-09-15. It stages as
a service Setting and shows a "Deploy Changes" dialog, but the button is a confirm for the
setting, not a container redeploy. (Alt+click, which the docs say commits without a
redeploy, silently does nothing for this change type — use the normal click.) The proxy
lands immediately and `railway run` picks the host up on the next call, no restart.
There is no CLI subcommand for it; the only non-UI route is the GraphQL `tcpProxyCreate`.

**Remove the proxy again when finished** — it exposes prod Postgres publicly as the
`postgres` superuser.

**Read prod Postgres through its LOG instead.** `railway logs -s Postgres-HipHipHip-test
-e production -S 14d -n 5000 --filter "<text>" --json` is the working instrument, and the
server is configured to make it a good one: `log_lock_waits=on` (so every wait past the
1s `deadlock_timeout` prints `still waiting … after N ms` and its matching `acquired …
after N ms`), `log_min_error_statement=error` (so a cancelled statement prints its own
SQL on the next line, correlatable by `[pid]` + second), plus connection/disconnection
and `temporary file:` spill lines. `log_min_duration_statement` is OFF, so successful
durations are the one thing the log cannot give you. `-n` caps at ~5000 per call and
`--filter` without `-S` only scans a recent window — always pass `-S`.
The Api's own `railway logs -s Api --http --json` carries `totalDuration` /
`upstreamRqDuration` / `path` / `httpStatus`, filterable with `@totalDuration:>5000`.
Worked example: [[project_directus_prod_query_timeouts]].

**`railway ssh` lands in an ephemeral sandbox, not the running container** — confirmed
on a dev service (host uptime 101 days but only 9 pids, `/proc/1` unreadable). A `pm2
jlist` run there spawned a brand-new pm2 daemon (and launched `pm2-autoscale` under it)
inside that sandbox; the live container and its real process pool were untouched
throughout (API kept answering 200). So `railway ssh` cannot be used to inspect a live
pool's processes/CPU — use `GET /utils/processes` (needs an admin static token,
[[project_directus_pr448_details_narrowing_bug]]) or the `scalabus-dev` system-mcp tools
instead; both read the real container via the app's own bus, not a shell into it.

**Traps:**
- `railway link` without `-e` fails with *"--environment required in non-interactive
  mode"* and leaves nothing linked.
- **`railway redeploy` takes no `-e` flag at all** — it always uses the current
  directory's link. Verify `railway status`/the link before firing it, the same
  "-e is required" discipline as `link`/`run`, just enforced differently (silently,
  by picking whatever the directory happens to point at).
- The prod DB service is **`Postgres-HipHipHip-test`** (the `-test` suffix is a
  historical name, it is production). `hhh-postgres-18` and `Postgres-HipHipHip-17`
  also exist — check `RAILWAY_VOLUME_NAME`/`railway status` before trusting one.
- `redis-cli --scan --pattern '*<hash>*'` over the whole keyspace does not finish in
  a tool timeout; `exists` on a constructed key answers instantly.
- Put the SQL in a file and use `psql -f`; multi-statement `-c` strings and
  heredocs fight the shell ([[feedback_remote_python_via_ssh_stdin]] is the same
  lesson elsewhere).

Related: [[reference_railway_log_forensics]], [[reference_railway_variable_references]].
