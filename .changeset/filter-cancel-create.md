---
'@directus/api': minor
---

Let an `items.create` filter take over the creation by returning a primary key. When a `*.items.create` filter returns a `string`/`number` instead of a payload, `ItemsService.createOne` short-circuits the insert and surfaces that key (e.g. dedupe to an existing row, or hand off to an external store). Builds on the typed filter output (`FilterHandler<TIn, TOut>`); a filter returning a normal payload object inserts exactly as before.
