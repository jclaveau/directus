---
name: project_directus_planner_issue774_sentiments_query
description: Planner issue #774 — GET /revising/sentiments/list-courses-sentiments issues a student_course_note O2M batch read with a 6-deep permission join and a 1.2k-11.5k+ id IN-list, p50 11.4s max 35.8s; root cause of both the prod statement_timeout blocker and the earlier open "planner #772" cause-unknown finding
metadata:
  author: Jean Claveau
  type: project
---

Filed **the-HipHipHip/Planner#774** — https://github.com/the-HipHipHip/Planner/issues/774
(planner repo, not this fork — the fix candidates are planner-side query shape).

**Root cause, found via prod PG log + `EXPLAIN ANALYZE` (25.5s, `loops=20273`,
0 rows returned):** `list-courses-sentiments` (`studying.left-menu.queries.ts:43`)
reads `student_course_note` with the fork's standard 6-deep permission-CASE join
down to `directus_users`, against an `IN` list of 1.2k-11.5k+ course ids — a 300×
fan-out misestimate versus the actual row count. Confirmed **not** an N+1 (single
batched raw query), **not** a missing index, and **not** pool starvation riding the
lock-wait convoy (2.9% co-occurrence vs a 3.3% base rate) — all four candidate
causes tested and refuted before landing on the permission join itself.

This is the same query class behind the 35 unexplained 60s statement cancels from
2026-09-11/12, and resolves the "cause still open, suspects getSchema()/permission
aggregate" line that had been carried in
[[project_directus_prod_query_timeouts]] since the first 24-day `pg_stat_statements`
read. It is a query-shape bug, not a timeout-sizing input — see that memory's
09-16 update for why `statement_timeout` step 2 is held until this ships.

**Ranked fixes in the issue body** (planner-side):
1. Scope the `student_course_note` read permission by `user_created` instead of
   the current course-visibility chain — removes the 6-deep join entirely.
2. Request explicit fields instead of `courses.*` — cuts the fan-out even with
   the join left in place.
3. Chunking the id list does **not** help — the join cost scales with the
   permission evaluation per row, not the IN-list size alone.

**Not done, offered:** a comment on Planner#772 (the older, now-closed-by-finding
investigation) pointing at #774 as the actual pool-contention cause. Jean has not
said "comment 772" — don't post it without that.

Scratch kept in `$T/pgprod/` (`explain-analyze.sql` + the reusable id list) for the
after-fix re-measurement — job-scratch, not this project's `tmp/`.
