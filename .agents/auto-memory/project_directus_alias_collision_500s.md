---
name: project_directus_alias_collision_500s
description: Directus's random join-alias generator collides in prod, ~33 times a day every day, and Postgres rejects the query outright with 42712
metadata:
  type: project
---

Measured on prod 2026-09-15 from the PG log: **469 errors in 14 days, 26-43 every single
day**, no gaps.

```
ERROR:  table name "klgzb" specified more than once
```

Postgres refuses a `FROM` list that binds one alias twice (42712, verified directly:
`SELECT 1 FROM pg_class a LEFT JOIN pg_class a ON true` → same error). So the query never
runs — the caller gets a 500, not a slow response.

Cause is Directus's random 5-character join alias. A deep read builds one alias per
relational hop; a permission-CASE read on a nested collection chains 6-7 joins
(`student_course_note` → `student_course` → `student_teaching_unit` →
`student_discipline` → `student_enrollment` → `student` → `directus_users`), and two hops
in the same statement eventually draw the same string. Birthday collision, so it scales
with joins per query and with traffic, not with any one endpoint.

Find them with
`railway logs -s Postgres-HipHipHip-test -e production -S 14d --filter "specified more than once"`
([[project_directus_prod_db_access]]). The log gives the colliding alias but not the
statement — `log_min_error_statement=error` prints a `STATEMENT:` line, correlate on
`[pid]` + second.

The fix is on the generator, not the query: make the alias collision-proof per statement
(a counter, or check-and-retry against the aliases already issued) rather than widening
the random string, which only moves the rate.

Filed as fork issue **#485**.

Related: [[project_directus_prod_query_timeouts]], [[project_directus_filter_normalization_layers]].
