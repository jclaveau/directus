---
'@directus/api': minor
'@directus/types': minor
---

Add the `items.created` and `items.updated` filter events (and `<collection>.items.created` / `.updated`, `<system scope>.created` / `.updated`), emitted once a create or an update has written its rows, inside the mutation transaction and before it commits. A hook reads the written rows back through `context.transaction`, a write it makes there commits with the mutation, and a hook that throws rolls the mutation back. It must answer nothing or the rows it was handed.
