---
'@directus/api': patch
---

Fixed deeply nested relational filters silently dropping sibling keys. `getFilterPath` only follows `Object.keys(value)[0]`, so a filter like `{ rel: { a: {...}, b: {...} } }` only applied the first branch's WHERE/JOIN conditions. A `normalizeFilter()` pass now splits multi-key relational objects into `_and` arrays before joins and where clauses are built, so every relational path is applied.
