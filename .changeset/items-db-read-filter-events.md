---
'@directus/api': patch
---

Added `items.db.select` / `items.db.selected` filter hooks (and their collection-scoped `<collection>.db.select` / `<collection>.db.selected` variants) around the read query in `runAst`. `db.select` receives the pending knex query builder so a hook can adjust it before it runs; `db.selected` receives the raw rows straight off the database so a hook can inspect or replace them before any transform. With no listeners registered both are a no-op.
