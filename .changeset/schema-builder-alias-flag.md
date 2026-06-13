---
'@directus/schema-builder': patch
---

Set `alias: true` on `type: 'alias'` fields (o2m, m2m, m2a, translations) built by `SchemaBuilder`, matching real Directus schemas where relational alias fields carry the flag. Previously these were built with `alias: false`, which diverged from production and hid alias-dependent code paths from tests.
