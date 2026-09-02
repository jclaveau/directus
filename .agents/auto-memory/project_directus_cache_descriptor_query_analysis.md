---
name: project_directus_cache_descriptor_query_analysis
description: How to classify cached reads by filter shape from directus_cache_descriptors.query, and the CTO-gate that blocks arbitrary SQL on the prod Railway DB
metadata:
  type: project
---

`directus_cache_descriptors.query` stores **the raw URL query string as sent**
(`respond.ts`), so cached reads can be classified by filter shape. Join against
`directus_relations` to tell a relational alias from a scalar field — `filter[status][_eq]`
and `filter[categories][_eq]` look identical to a regex but only the second joins.

```sql
WITH aliases AS (
  SELECT one_collection AS collection, one_field AS field FROM directus_relations
  WHERE one_field IS NOT NULL AND one_collection IS NOT NULL
), d AS (
  SELECT collection, replace(replace(query,'%5B','['),'%5D',']') AS q
  FROM directus_cache_descriptors WHERE last_filled IS NOT NULL
)
SELECT d.collection, a.field,
       (regexp_match(d.q, 'filter\[' || a.field || '\]\[(_[a-z_]+)\]'))[1] AS op, count(*)
FROM d JOIN aliases a ON a.collection = d.collection
WHERE d.q ~ ('filter\[' || a.field || '\]\[_[a-z_]+\]')
GROUP BY 1,2,3 ORDER BY 4 DESC;
```

Validate the regex against synthetic strings first: the LOCAL planner DB has **zero**
descriptors carrying any `filter[`, so 0 rows there means "no data", not "no exposure".

**Prod access is gated.** `data/db_query_railway.sh` hard-exits when
`RAILWAY_ENVIRONMENT=production`: "Don't do it without the go of the CTO — please comment
those lines to enable it". Enabling means editing out the guard, and the harness
classifier ALSO blocks touching that script (even a `cp`) regardless of jean's verbal go.
Hand him the command to run with `!` instead of routing around it
([[feedback_dont_reflexively_bypass_enforcement]]). It also needs `-e production` —
`railway environment` cannot prompt non-interactively.

Related: [[reference_pn_db_query_local]], [[project_directus_cache_stats_table_roles]].
