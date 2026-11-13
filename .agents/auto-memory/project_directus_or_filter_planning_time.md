---
name: project_directus_or_filter_planning_time
description: A large `_or` unicity filter (one branch per input row) costs Postgres PLANNING time, not execution; pg_stat_statements hides it; exact flat rewrites measured for fork #735
metadata:
  author: Jean Claveau
  type: project
---

A consumer's batch create looked up existing rows with `_or: rows.map(toFilter)` → 1,688 branches, 6,755 bind params, 8 permission left joins. `EXPLAIN (GENERIC_PLAN)` Planning Time 10.4 s, the request ~26 s, and the query returns 0 rows. The consumer fixed it with one `_in` per leaf field (POST 30.6 s → 2.9 s locally); fork #735 is the exact rewrite inside Directus.

**Why:** `pg_stat_statements` showed ~392 ms DB time for a 6.4 s request (`track_planning` off) and the Node profile was ~80% idle; both pointed away from the cause.

**How to apply:**
- Request slow + pgss total tiny + Node profile idle → `EXPLAIN (GENERIC_PLAN)` the statement (its text is in pgss), read Planning Time first.
- Measured rewrites of the same lookup:

  | shape | planning |
  |---|---|
  | `_or` of 1,688 `_and` branches | ~10–12 s |
  | row-value `(a,b) in ((..),(..))` | ~12 s (Postgres expands it to the same `or`) |
  | `(a,b) in (select * from (values …))` | 16 ms, exact, flat |
  | `unnest(arrays)` join | 15–22 ms, exact, flat |

- Per-call planning grows with the permission `left join` count: 0.19 ms at 0 joins → ~6–7 ms at 7–11 (full suite with `track_planning` on: planning 20.8 s vs exec 38.8 s).
