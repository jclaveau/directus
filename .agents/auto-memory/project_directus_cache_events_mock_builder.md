---
name: project_directus_cache_events_mock_builder
description: "cache-events.test.ts shares ONE knex mock builder resolved by `lastTable` at await time — building two query builders before awaiting either makes both read the last table, so code that is correct against real knex goes red"
metadata:
  type: project
---

`api/src/cache-events.test.ts` hand-rolls its knex stub as a **single** `builder` object:

```ts
builder = { join: vi.fn(() => builder), where: …, then: (res) => {
    const rows = rowsByTable[lastTable] ?? queryRows;   // read at AWAIT time
    return Promise.resolve(rows).then(res);
} };
mockDb = vi.fn((table) => { lastTable = table; return builder; });
```

So `db('a')` then `db('b')` then awaiting the first resolves it against **`b`**. Real knex
builders are independent, so production is fine and only the test lies.

**It bit on #350**: a helper returning `{ byTag, byCollection }` builders (built up front,
awaited in a loop) turned 3 green listing tests red — the tag arm read the collection arm's
rows, counts doubled. Not a production bug.

**Fix taken:** build one query per call —
`scopedCachePurgeCoverage(db, reach: 'tag' | 'collection', …)` returning a single builder, each
constructed immediately before its await. Better code anyway, and it no longer depends on
construction order. **Do not** contort further than that; and do not "fix" the mock casually —
per-call builders would break every `expect(builder.where).toHaveBeenCalledWith(…)` in a
2500-line file, since `builder` would then point at the last one only.

**The stub gained a `first()` terminal (2026-08-13)**, staged per call because the descriptor
lookup fires two queries against the SAME table (`cache_key` arm, then `redis_key` arm) and they
must be answered apart:

```ts
let firstRows: any[];                                   // reset [] in beforeEach
first: vi.fn(() => Promise.resolve(firstRows.shift())), // answers in call order
```

`rowsByTable` cannot serve those two — it keys by table name, and both calls name
`directus_cache_descriptors`.

**How to apply:** in this file, never hold more than one un-awaited builder at a time, and never
`Promise.all` two queries. If a refactor needs concurrent builders, the real SQL is covered by
the blackbox suite — assert there rather than fighting the stub
([[feedback_mock_fixture_and_dom_false_positive]], [[feedback_integration_first_unit_fills_gaps]]).
