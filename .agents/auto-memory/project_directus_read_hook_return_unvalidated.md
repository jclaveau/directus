---
name: project_directus_read_hook_return_unvalidated
description: An items.read hook's return value is passed through unvalidated and withMeta then rejects a non-object — a 500 raised inside whatever transaction was reading
metadata:
  type: project
---

`readByQuery` does **not** return `runAst`'s rows. It returns whatever the `items.read`
filter hook handed back:

```ts
const filteredRecords = opts?.emitEvents !== false
    ? await emitter.emitFilter(['items.read', …], records, …)
    : records;
…
return withMeta(filteredRecords as Item[], { … });
```

`emitFilter` propagates a listener's return verbatim — only `undefined` is ignored — and
`as Item[]` asserts rather than checks. But `withMeta` does
`Object.defineProperty(value, 'getMeta', …)`, which **throws on a non-object**. So a hook
returning null does not make reads resolve to null: the read throws.

Consequences:
- `runAst`'s own null is caught (`if (records === null) throw new ForbiddenError()`); the
  hook's return is not. The **write** path validates its filter returns
  (`payloadAfterHooks === null`); the read path has no equivalent. TODO left at the site.
- The blast radius is any read inside someone else's transaction. `updateMany`'s revision
  snapshot is one: the request 500s and the whole update rolls back.
- Therefore `snapshots` is always an array, and the `Array.isArray(snapshots)` guard plus
  the ternary beside it in the revision block **cannot fire**. Both now carry comments
  saying so — do not re-derive.
- `readOne` reaches for `results.length`, so a null there is a different failure than the
  batch route, which passes `readMany`'s value straight to the response.

Covered by `tests/blackbox/tests/db/routes/items/read-hook-null.test.ts`, which pins the
500 and the rollback. That test is a change-detector: fixing the TODO SHOULD break it.

Related: [[reference_directus_emitfilter_same_ref]], [[feedback_ts_as_cast_smell]].
