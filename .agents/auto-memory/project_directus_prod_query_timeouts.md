---
name: project_directus_prod_query_timeouts
description: What the prod Postgres 60s statement_timeout actually kills (measured 2026-09-15 from the PG log) — lock waits and one migration, never a slow read — the three-knob split that follows, and step 2 sized on dev from the planner's longest transaction
metadata:
  type: project
---

Measured 2026-09-15 from the prod Postgres log and the Api HTTP log (no psql needed, and
none available — see [[project_directus_prod_db_access]]).

**Settings in force** (read back over psql 2026-09-15, PG **18.4**): `lock_timeout=0`,
`idle_in_transaction_session_timeout=0`, `transaction_timeout=0` (PG18 has it, unused),
`deadlock_timeout=1s`, `log_lock_waits=on`, `log_min_duration_statement=-1` (off),
`work_mem=32MB`, `shared_buffers=4GB`, `effective_cache_size=18GB`, `max_connections=100`.
`pg_stat_statements` 1.12 and `timescaledb` 2.28.3 are installed.

The 60s is **not** a server default — it is
`ALTER ROLE postgres SET statement_timeout = '1 min'`, the only row in
`pg_db_role_setting`. The cluster default is 0. The app and the migrations both connect as
`postgres`, so that one row governs both.

Railway's edge caps a request at **300s** (the >5s population piles up at 300006-300017 ms).

**The distribution, 24 days / 771M calls** (`pg_stat_statements`, reset 2026-08-22):
99.178% of calls under 1 ms, 100.0000% cumulative under 10 ms; only 13 statement kinds
have a mean at or above 10 ms. Slowest **read** on record: **819 ms** (4 calls), next 80 ms.
Slowest **write**: max 59995 ms against a **mean of 9.3 ms and a min of 0.0 ms** — a queue,
not work. `update "student_course" set "name"=…` alone is **42.9% of all database time**.

**Validity limit:** `dealloc` is 1731968 against `pg_stat_statements.max=5000`, so that
819 ms is the max among 4873 *resident* entries, not a census — a rare slow read can have
been evicted. The log is complete above 60s and shows only two read classes there, so the
blind spot is 1-60s reads, which is exactly what `log_min_duration_statement` would fill.

**What the 60s kills.** 1157 cancels 2026-08-23 → 09-12, 684 attributable to a
`STATEMENT:` line:

| share | statement |
| --- | --- |
| 95% (649) | `update "<t>" set … where "id" in ($n)` — single-row PK update on `student_course` / `student_teaching_unit` / `student_time_slot` |
| 3 | `SELECT create_hypertable('directus_scoped_cache_purge_tags', …, migrate_data => true)` — all on 2026-09-02, the migration |
| 35 | a permission-CASE read on `student_course_note` — 2026-09-11/12 only, 8 of them lock-waiting, the rest unexplained |

57% of cancelled pids also logged a lock wait. The updates carry no execution cost at
all — they are row-lock waiting, and `statement_timeout` is the only thing bounding it.

**Lock waits are bimodal against the ceiling.** 2534 waits over `deadlock_timeout`:
p50 1.6s, p75 5.1s, **p90 58.9s**, p95 59.9s, max exactly 60000 ms; 25% over 5s, 15%
over 30s. Nothing exceeds 60s because the statement timeout cuts it there. 1091 of the
1232 relation-level waits are on one relation (oid 27061).

**Execution itself is fast.** Api `upstreamRqDuration`: p50 76 ms, p95 732 ms, p99 1.0s,
p99.5 2.0s — then p99.9 52s. The cliff between p99.5 and p99.9 is the convoy, not compute.

**So one knob is doing three jobs.** The split:

- `lock_timeout = 5s` — sits at p75 of real waits; turns a 60s held connection into a
  retryable error, ~45 events/day.
- `idle_in_transaction_session_timeout = 60s` — nothing legitimate holds one, and it is
  what breaks a convoy at its *head*. No such termination has ever been logged.
- `statement_timeout` — **do not lower it on this evidence.** The log carries no
  successful-statement durations, so any number below 60s is a guess. Turn on
  `log_min_duration_statement='1s'` for a week first; expect to land 20-30s.
- Migrations need *more*, not less: `SET LOCAL statement_timeout = 0` inside the #421
  migration transaction fixes the `create_hypertable` class outright.

**Where it can be set.** The app connects as **`postgres`**, the same superuser the
migrations use, through PgBouncer (sessions recycle at ~1h). So a session `SET` from
knex `afterCreate` **leaks across clients** under transaction pooling, and a per-role
`ALTER ROLE` cannot separate request-serving from migrations. Use `ALTER DATABASE` for
the floor and `SET LOCAL` for per-transaction exceptions, or give the API its own role.

**The cure for 95% of these is not a timeout** — it is planner PR #769's PATCH
serialization, merged to develop and **not yet in prod**.

**Two unrelated things the same data exposed** (fork #486 and planner #772): `SET application_name=$1` is 533M calls —
**69% of every statement the database runs** — and 11.6% of total exec time, because the
fork's per-connection `application_name` makes every pgbouncer client distinct under
transaction pooling. And `/revising/sentiments/list-courses-sentiments` runs to the 300s
edge cap while its own query means 0.9 ms over 6.39M calls and EXPLAINs at cost 21. It is
**not** an N+1 (one batched raw query), not a missing index, and not pool starvation behind
the convoy (2.9% co-occurrence against a 3.3% base rate) — all four refuted, cause still
open, suspects are `getSchema()` and the permission aggregate. Planner #772.
See also [[project_directus_alias_collision_500s]].

Related: [[project_directus_migrations_transaction_and_health]],
[[project_directus_pgbouncer_admin_console]], [[project_directus_cache_entries_query_perf]].

## Applied 2026-09-15

Step 1 is live on prod, set by jean:

```sql
ALTER DATABASE railway SET lock_timeout = '5s';
ALTER DATABASE railway SET idle_in_transaction_session_timeout = '60s';
ALTER DATABASE railway SET log_min_duration_statement = '1s';
```

`pg_db_role_setting` now holds two rows — the pre-existing
`postgres → statement_timeout=1 min` (role-level, still 60s) and the new
`railway → {lock_timeout, idle_in_transaction_session_timeout,
log_min_duration_statement}` (database-level). Database level was chosen over
`ALTER ROLE … IN DATABASE` so the knobs stay off `grafana_config` and `flowise`,
where role `postgres` also connects.

statement_timeout stays 60s pending a week of the new `duration:` log lines;
sizing it blind was the thing to avoid. The draft, with the step-2 command,
rollbacks and the migration `SET LOCAL` note, is
`planner_2/apps/directus/data/ops/prod-timeouts.sql`.

Rollout measured right after the change: 15 Api backends, oldest 57 min, 4 under
10 min — PgBouncer's `server_lifetime=3600` recycles the whole pool inside an
hour, no restart needed. The one connection that does not recycle is Timescale's
own `TimescaleDB Background Worker Scheduler` (pid 782, age 23 days, no
`client_addr`), which keeps the old values until a PG restart; the job workers it
spawns connect fresh and do get them.

`application_name` reads `directus:<nodeId>:base`, one nodeId per pm2 worker, so
that column counts live workers — 9 at the time of the change.

## Step 2 sized on dev, 2026-09-15 — the duration logs arrived

The week of `duration:` lines the statement_timeout cut was waiting for is no
longer needed: dev was given the same three knobs, and jean ran the planner's
longest transaction against them under a live `pg_stat_activity` sampler and a
`pg_stat_statements` before/after diff.

**The transaction** — pid 49807, 01:40:13 → 01:42:07 UTC, **113.9 s wall clock**:

| metric | value |
| --- | --- |
| statements in the window (whole DB) | 12 761 |
| total server exec time | **3 139 ms** |
| Postgres' share of wall clock | **2.8%** |
| slowest single statement | **154 ms** (`insert into student_schedule_segment_student_course`, 1688 calls) |
| statements ≥ 1 s in the log | **0** |
| longest idle-in-transaction gap | **62 ms** (p50 1 ms, p95 10 ms) |
| lock waits / errors / timeouts | **0**, over three days of log |

So the two minutes are **round-trip latency, not database work** — ~12.7k
statements at ~9 ms each. The lever for shortening it is batching (1688 single-row
inserts into one table), not a timeout.

**What actually binds a `statement_timeout` cut is not the app path.** Nothing in
the transaction reaches 1 s. The floor comes from two other statements: the
`VACUUM ANALYZE` cron (2.8-3.3 s on dev - the *only* >=1 s `duration:` lines in
three days) and `count("student_time_slot"."id")` (max 6.6 s, mean 1.36 s). **15 s**
leaves 2.3x over the count and 97x over anything the transaction did.

**The vacuum figure does NOT transfer to prod, and it blocks the prod apply.**
`DB_VACUUM_CRON_FREQUENCY` is `*/20 * * * *` on dev but `0 6 * * *` on prod, and
`apps/domain/src/administration/back/commands/vacuum-postgres.ts` vacuums every
table carrying dead tuples - so prod's single daily run sweeps 24 h of accumulation
across `student_time_slot` (13.9M rows / ~10 GB) where dev's sweeps twenty minutes
of it. Both its statements are plain `knex.raw` with no exemption, and
`statement_timeout` does apply to a manual VACUUM (autovacuum is the exception;
this is not autovacuum). If prod's daily run exceeds 15 s it is killed and the
planner stops being vacuumed.

Step 1's `log_min_duration_statement=1s` is already live on prod, so the next 06:00
run logs its own duration - read that before running the `ALTER ROLE` line. The
usual exemption is closed here: VACUUM cannot run inside a transaction block, so
the migrations' `SET LOCAL statement_timeout = 0` has no transaction to be local
to, and a plain `SET` leaks to the next client under PgBouncer transaction pooling.
Exempting it needs a direct non-pooled connection.
`idle_in_transaction_session_timeout` is unaffected and can go on its own.

`idle_in_transaction_session_timeout` can come down to **15 s** on the same
evidence (240× the observed 62 ms max gap). `lock_timeout` stays 5 s — dev logged
no waits at all.

**Leave `transaction_timeout` unset.** It is the one knob that would have killed
this run, at any value under ~120 s, and the length scales with statement count,
which scales with import size — a cap there caps how big an import a user may do.

**One query already lives at the ceiling** and is the only thing whose behaviour a
cut changes: the fork's `getTablesSize` hypertable query, 409 542 calls, mean
147 ms, **max 59 969 ms** — 31 ms under the cap, so either a kill recorded at the
boundary or a very near miss. **No user, no request, no admin page reaches it.**
Its only callers are the two in `enforceCacheStatsBudget()`
(`api/src/cache-events.ts:2361,2389`), on the cache-stats drain tick —
`CACHE_STATS_DRAIN_SCHEDULE`, `*/10 * * * * *`, one synchronized node. 8640 calls a
day is where the count comes from.

Cutting to 15 s **improves** it rather than risking it: the tick already wraps both
calls in a `catch` that logs a warn, `drainCacheEvents()` runs first in the same
tick so a kill loses no events, and the next tick retries 10 s later. Failing at
15 s and retrying beats holding a pooled connection for 60 s and failing anyway.
Nothing user-facing changes at 15 s.

**Sampler trap:** dev pooling reuses a backend across the VACUUM cron and the app,
so pid 49807 ran the 3 s `VACUUM ANALYZE` at 01:40:00 and *then* the transaction at
01:40:13. The first four samples of "the transaction" are the VACUUM. Segment a
`pg_stat_activity` capture on `xact_start` resets, never on pid alone.

Instruments (throwaway, `/home/jean/.claude/jobs/b42c3455/tmp/pgdev/`): a
`pg_stat_statements` snapshot before and after diffed on `calls`, plus
`\watch interval=2` over `pg_stat_activity` filtered to `xact_start IS NOT NULL`.
The 2 s sampler alone undersamples — it is what gives transaction *total* duration
and idle gaps, which `pg_stat_statements` does not carry; per-statement maxima come
from the diff, and anything ≥ 1 s from `log_min_duration_statement`.

### Applied on dev 2026-09-15

```sql
ALTER ROLE postgres SET statement_timeout = '15s';
ALTER DATABASE railway SET idle_in_transaction_session_timeout = '15s';
```

Verified in a fresh session: `statement_timeout=15000`,
`idle_in_transaction_session_timeout=15000`, `lock_timeout` 5 s and
`transaction_timeout` 0 untouched. `pg_db_role_setting` holds the same two rows as
before, now carrying the new values.

Dev's cluster mirrors prod's exactly — databases `flowise`, `grafana_config`,
`postgres`, `railway`, and the same `<all db> | postgres | statement_timeout` row.
So `statement_timeout` went on the ROLE for the reason the draft gives (a
database-level one is shadowed by that role row), and dev now rehearses prod
including the blast radius onto `flowise` and `grafana_config`.

Rollback: `ALTER ROLE postgres SET statement_timeout = '1 min';` and
`ALTER DATABASE railway SET idle_in_transaction_session_timeout = '60s';`

**psql flag trap:** `-echo-all` is not a psql flag (it is `-a` / `--echo-all`).
`railway run … psql -echo-all -f -` fed `ho-all` to the server as a statement and
died with `ERROR: syntax error at or near "ho"` *before* reading stdin, so the file
never ran — check `pg_db_role_setting` rather than assuming a partial apply.

## Challenged with 23h of prod log, 2026-09-16 (09-14 23:55 → 09-15 23:00 UTC)

Scratch was `$T/pgprod/dur.json` (413 lines ≥1s, complete, under the 5000-row cap).
Per-knob verdict against step 1 (live since 09-15):

- **`lock_timeout=5s` — harmless, not yet exercised.** Zero `canceling statement`
  lines of any kind in 23h. Waits since the change: n=25, p50 1.3s, max 2.8s — well
  under 5s. The pre-change window (09-14 19:38 convoy) had 16 waits at 5.9-7.9s that
  *would* now cancel. Keep as is.
- **`idle_in_transaction_session_timeout=60s` — FIRED 15×, refuting "nothing
  legitimate holds one."** Three bursts, all Api (`idle-in-transaction timeout` +
  `ROLLBACK - Client has encountered a connection error`): one burst of 9
  `POST /items/student_time_slot` from one IP each idle exactly 60.07-60.2s; two
  bursts (21:32-21:33) where 26 then 35 requests across many users/paths 500'd at
  the *same instant*, durations 60-149s — a whole-worker stall where everything in
  flight dies together on resume. Cause still unknown (event-loop block vs an
  awaited Redis purge held inside the open transaction — #392 fan-out is a
  candidate); no clean alignment with autoscale add/release timing (±30s).
  **Do not drop this to 15s before the cause is understood** — each fire converts a
  stalled-but-would-eventually-succeed request into a 500, and at 15s the count
  becomes unmeasurable from PG (only kills get logged).
- **`statement_timeout` still at 60s (step 2 sized on dev, not yet applied to
  prod) — blocked on real prod traffic by one query.** A permission-CASE read on
  `student_course_note` (6-deep join down to `directus_users`, `IN` list 1.2k-11.5k+
  params, log line truncated at 80KB): 169 runs ≥1s, p50 **11.4s**, p90 18.5s, max
  **35.8s**, 37/day over 15s, 2161s of cumulative connection time. Issuer:
  `GET /revising/sentiments/list-courses-sentiments?courses=[…]` — same query class
  as the 35 unexplained 60s cancels from 09-11/12. **This resolves the "cause still
  open" line above**: the suspect was never `getSchema()`, it's this
  permission-joined O2M batch IN-read. Filed as
  [[project_directus_planner_issue774_sentiments_query]]. Until fixed: 15s kills
  37/day; 40s clears the observed max.
- **VACUUM: zero lines in 36h.** The 06:00 cron either ran <1s per table (unlikely
  given `student_time_slot`'s 13.9M rows) or didn't run — verify on the planner
  side before cutting `statement_timeout` further, since the dev sizing above
  depends on the vacuum figure transferring.
- **Contaminant:** the autoscaler made 619 decisions in 19h (286 up / 333 down),
  flapping 1↔4 every 15-90s during the 21-22h peak, with 44
  `[autoscale] a tick failed` at `releaseWorkers` ([[project_directus_issue495_release_bound]]).
  Api had 4075 requests >8s (1264 in hour 21) in that same window — any timeout
  reading in this period sits inside that churn, not a clean baseline.

**Recommendation as of 09-16:** keep step 1 (lock/idle at current values), hold
step 2 (`statement_timeout` cut) until the sentiments query is fixed, then
re-measure the idle-in-transaction stalls with the churn removed.
