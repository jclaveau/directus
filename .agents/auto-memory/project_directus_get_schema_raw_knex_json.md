---
name: project_directus_get_schema_raw_knex_json
description: api get-schema reads directus_collections via RAW knex.select (bypasses the cast-json items pipeline), so JSON meta columns come back dialect-native — parse with @directus/utils parseJSON + handle the already-array PG case
metadata:
  type: reference
---

`api/src/utils/get-schema.ts` builds the SchemaOverview by reading `directus_collections` with a
**bare `knex.select(...).from('directus_collections')`** (runs on every schema load → perf). That
path **bypasses the items/`cast-json` pipeline** that would normally parse special-cast columns.

**Consequence for a JSON meta column** (e.g. the scoped-cache `scoped_cache_fields`, sibling of
`item_duplication_fields`): the raw select returns it **dialect-native** —
- **Postgres** `json`/`jsonb` → already a parsed **array/object**
- **MySQL / SQLite** → a **JSON string**

So a JSON meta column pulled into the overview needs a small normalizer: array passthrough (PG) +
`JSON.parse` for the string branch + degrade to `[]` on anything odd. Use **`parseJSON` from
`@directus/utils`** for the string branch — it's `JSON.parse` hardened against `__proto__`
prototype-pollution (a JSON meta column could carry it); a raw `JSON.parse` would not be. knex has
**no** cross-dialect result-parse helper (its `jsonExtract`/etc. build SQL, don't normalize results).

**How to apply:** adding any JSON/array meta field to the overview → add the `select` column, a
`parseJsonFieldList`-style wrapper (parseJSON + array passthrough + `[]` fallback), and the
`CollectionOverview` field in `@directus/types`. The cast-json `special` in system-data only matters
when reading via CollectionsService, NOT here. Related: [[project_directus_scoped_cache_design]].
