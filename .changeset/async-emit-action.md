---
'@directus/api': patch
'@directus/types': patch
---

Made `emitter.emitAction()` async so an items-service mutation can optionally wait for its action hooks to finish before resolving. Action hooks remain **fire-and-forget by default** (unchanged behaviour); pass the new `awaitActionHooks` mutation option to block a create/update/delete until its action handlers have settled — useful when a client immediately reads back a side effect a handler produces (e.g. an aggregate recompute) and would otherwise race it. A mutation's action events — the item's own plus any nested ones, and the `items`/`<collection>`-scoped variants — run in parallel, so a slow handler on one event doesn't serialize the rest. `bypassEmitAction` now also accepts an async handler. Errors thrown by action handlers are still caught and logged, not propagated.
