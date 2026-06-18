---
'@directus/api': patch
'@directus/constants': patch
---

Skip item updates that have nothing to write — when the payload is empty, contains only the primary key, is cleared by an `items.update` filter hook, or reduces a nested relation to an all-empty `{ create, update, delete }`, the update now short-circuits and returns `[]` instead of running a no-op transaction, avoiding needless activity/revision rows and integrity checks. A bare empty relational array (e.g. `translations: []`) is intentionally **not** treated as a no-op, since for o2m it means "remove all existing children". A filter hook that clears the payload to `null` now raises `InvalidPayloadError` rather than silently no-op'ing — cancelling a mutation is a separate, opt-in capability (`allowFilterCancel`). Adds the `ALTERATIONS_KEYS` constant (`['create', 'update', 'delete']`, the keys of the `Alterations` type) to `@directus/constants`.
