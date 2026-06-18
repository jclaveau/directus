---
'@directus/types': minor
'@directus/api': minor
---

Allow a filter hook to declare a different output type than its input. `FilterHandler<TIn, TOut = TIn>` now carries a separate output type and returns `TIn | TOut`, threaded through `emitFilter`, `onFilter`/`offFilter`, and the `register.filter` hook registration. `emitFilter` additionally exposes the untouched input as `meta.originalPayload`. `TOut` defaults to `TIn`, so every existing filter keeps its exact signature — no caller changes.
