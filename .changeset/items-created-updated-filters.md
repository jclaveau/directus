---
'@directus/api': minor
'@directus/types': minor
---

Add the `items.created` and `items.updated` filter events (and `<collection>.items.created` / `.updated`, `<system scope>.created` / `.updated`), emitted once a create or an update has written its rows, inside the mutation transaction and before it commits. A hook reads the written rows back through `context.transaction`, a write it makes there commits with the mutation, and a hook that throws rolls the mutation back. The rows are already written, so it must answer nothing: any answer, the rows it was handed included, is refused.
