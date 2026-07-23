---
name: project_directus_blackbox_m2m_nested_and_cancel
description: bb test-design for cache-hook witnesses — real M2M nested-parent-update fires the junction's items.create (not a flat pivot POST), the scoped-instance pattern, REST cancel via allowFilterCancel, and per-file collection-name uniqueness
metadata:
  type: project
---

Reusable bb patterns for `context.scopedCache` hook witnesses (see [[project_directus_pr292_cache_hook_scopedcache]]).

**Real M2M, not a flat pivot.** jean: "we never push to the pivot table directly." Build a genuine M2M with `CreateFieldM2M(vendor, {collection, field, otherCollection, otherField, junctionCollection})` (adds the junction + its two FK fields, named **`${collection}_id`** and **`${otherCollection}_id`**). The take-over/dedup hook keys on the junction's `items.create` filter — a **parent update that nests related links** fires it:
```
PATCH /items/<left>/<id>  { authors: { create: [{ <right>_id: <existingId> }, { <right>_id: <newId> }], update:[], delete:[] } }
```
A scalar `<right>_id` links an EXISTING right row; Directus turns each nested `create` into a create on the junction (`payload.ts processO2M` → `getService(junction).createMany(createPayload, {emitEvents})`, ~L196/202) — and `createPayload` already carries the parent FK, so the junction `items.create` filter sees BOTH FKs. That's the real path (a client never POSTs the pivot directly). The take-over gate (`liveKeys>actionPayloads`) fires identically through this nested createMany.

**Junction `scoped_cache_fields`** (partition the junction cache by its left FK): `CreateFieldM2M` doesn't take junction meta, so set it via knex before spawning the scoped instance (`db('directus_collections').where({collection: junction}).update({scoped_cache_fields: JSON.stringify([leftFK])})`). Composite `UNIQUE(leftFK, rightFK)` also via knex (`db.schema.alterTable`). For NORMAL collections, prefer `CreateCollections` `meta.scoped_cache_fields` (API path) over knex.

**Scoped-instance pattern** (each cache-witness file): seed collections+items on the DEFAULT instance FIRST (so the spawned one sees `scoped_cache_fields` on boot), then `spawn('node',[paths.cli,'start'],{env})` with `CACHE_ENABLED/CACHE_AUTO_PURGE/CACHE_AUTO_PURGE_MODE=scoped/CACHE_STORE=redis/REDIS_PORT=6108/CACHE_STATUS_HEADER=x-cache-status` + a unique `CACHE_NAMESPACE`. Warm a slice (GET filtered by the scope field), mutate, re-read → assert HIT/MISS. `CreateItem` array bodies return rows with `.id`.

**Cancel (veto) via REST.** The items controller sets `allowFilterCancel:true` on create/update/delete, so a filter returning `null` cancels: a cancelled single create returns `{data:null}` 200; cancelled update/delete return a null-per-key. DELETE has no body, so a delete-cancel hook signals off the row's own field (readMany(keys) → inspect). Assert the row is UNCHANGED/UNDELETED to prove the cancel + non-vacuity.

**Collection names must be UNIQUE per test file** — bb shards share one vendor DB, so two files both creating `test_items_metric` collide. Give each file its own `test_items_*` prefix (article/author, order/summary, charge/invoice, editable/removable, moderated, post/tag). Builds on [[project_directus_blackbox_seed_mechanics]] / [[project_directus_blackbox_batch_seeds]].
