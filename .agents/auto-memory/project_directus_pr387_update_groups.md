---
name: project_directus_pr387_update_groups
description: PR #387 updateGroups — the settled shape of the grouped items.update / items.update.one events, what migrating a hook looks like, and the points already ruled on (do NOT re-raise)
metadata:
  type: project
---

`updateOne` / `updateMany` / `updateByQuery` / `updateBatch` all funnel through
`updateGroups`. Two events, opposite cardinalities:

- `items.update` — **once per update**, payload `Array<{ data, keys }>`, meta `{ collection }`.
- `items.update.one` — **once per row**, payload flat: `{ [primaryKeyField]: key, ...fields }`.

**Settled — do not re-litigate:**
- `meta.keys` is gone on purpose; keys travel with the data they describe. The websocket
  transform rebuilds the flat union.
- The per-row payload is the **change, not the row** — only the fields being written plus
  the PK. A hook needing current values reads the row back.
- Per-row `null` cancels that row alone. Per-group cancel was dropped, not deferred:
  per-row is strictly more expressive.
- Filters are ordered (group, then per-row); **actions are not** — `emitActionEvents` is
  `Promise.all`.
- `trackMutations`, `validateKeys` and the scoped-cache snapshot moved after the filter so
  hook-added keys are counted and validated. `validateAccess` already ran after it.
- Adjacent-merge only: no rewrite ⇒ the same single `WHERE id IN (…)` as before.
- One intentional behaviour change: `updateBatch` used to run the user-count integrity
  check even when it wrote nothing; it now agrees with `updateMany` — no write, no check.
- GraphQL is parked entirely until the rest lands.

**Migrating a hook** (four done in-tree): anything doing per-row work moves to
`items.update.one` and takes the key off the payload — `cache-cancel-write`,
`cache-purge-on-update`, `action-verify-schema` (`data.payload.collection`), and
`initCacheConfig` (`settings.update.one`; the grouped payload broke `'cache_ttl' in
payload` and silently stopped every TTL broadcast).

Design record: issue #335. Coverage groundwork merged first as #388.
Related: [[project_directus_blackbox_flakes]], [[feedback_cover_before_refactor]].
