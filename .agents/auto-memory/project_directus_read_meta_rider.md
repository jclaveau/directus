---
name: project_directus_read_meta_rider
description: The read-meta rider is typed end to end — withMeta runs after the read hooks, withoutMeta strips it for domain conversions, readResult() builds it in mocks
metadata:
  type: project
---

Every read method (`readByQuery`, `readOne`, `readMany`, `readSingleton`, and the
`AbstractService` interface) declares `Promise<WithMeta<T>>`, where
`WithMeta<T> = T & { getMeta(): ReadMeta }`.

**Why the type is honest:** `withMeta()` is the *last* statement of `readByQuery`
(`items.ts:1373`), after the read hooks have run — so the rider is on every value a
read returns. `readMeta(value: unknown)` returning `| undefined` is for callers
holding something that may not be a read result (e.g. `res.locals['payload']`), not
an admission that reads may lack it.

**Three pieces:**

- `withMeta(value, meta)` — attaches a non-enumerable `getMeta`. Production only.
- `withoutMeta<T>(value: WithMeta<T>): T` — identity at runtime, strips the type.
  Used at the **13** sites that convert a read result into a domain type, because
  `WithMeta<Item[]>` will not convert to `Permission[]`: the intersection carries a
  `getMeta` the target lacks.
- `__utils__/read-result.ts` → `readResult(rows)` — what the **18** mocks use. Calls
  the production `withMeta`, so a mocked read hands back the same object a real read
  would. They previously resolved bare arrays — standing in for a shape the service
  never returns.

**Where it flows:** `readByQuery` → `readMeta(result)?.scopedCacheTags` in the
controllers → `res.locals['scopedCacheTags']` → `respond.ts` → the cache entry's
tags and the response header. Drop the rider and every read caches untagged.

**Gotcha:** inside a `.reduce` over a read result the row is already a plain `Item` —
the wrapper is gone. Wrapping there is wrong; the compiler catches it, but the strip
sites need judgement rather than a sweep.

**Since #429 merged (`6dc12247b6`):**

- `readResult()` and `api/src/__utils__/read-result.ts` are **gone** — the eleven test
  files call `withMeta(rows, { scopedCacheTags: [] })` directly, matching what
  `controllers/items.test.ts` and `graphql.test.ts` already did. Where a mock resolves a
  named fixture, the wrapper sits on the fixture's own declaration so the
  `mockResolvedValue(x)` line stays as upstream wrote it.
- **`MaybeWithMeta<T> = T & { getMeta?(): ReadMeta }`** covers the other direction — a
  consumer that neither needs the meta nor minds it. It exists because `userName` takes
  `Partial<User>`, a **weak type**, and TS refuses `Item & { getMeta }` against one
  (TS2559); declaring the key optional supplies the shared property. That retired the five
  `userName(withoutMeta(…))` strips. Its cost is in its docblock: `getMeta` is now shared
  by every read result, so `WithMeta<Permission>` satisfies `MaybeWithMeta<Partial<User>>`
  too. See [[reference_ts_weak_type_check]].
- **The eight remaining `withoutMeta` calls are all load-bearing** and `MaybeWithMeta`
  cannot replace them. Removing only the strip, keeping each `as X`, gives eight identical
  **TS2352** "neither type sufficiently overlaps". They differ from the `userName` sites by
  carrying *two* mismatches — the rider *and* the domain narrowing — and the wrapper only
  addresses the first. `as MaybeWithMeta<FieldMeta[]>` does compile, but only relocates the
  cast. What retires them is #431 / [[project_directus_service_type_parameter]].
- `PermissionsService.readByQuery` no longer strips then calls `readMeta()` on the stripped
  value; `result` keeps its type and the tags come off `result.getMeta()`.
