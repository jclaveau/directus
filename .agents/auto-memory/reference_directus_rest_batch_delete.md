---
name: reference_directus_rest_batch_delete
description: Directus REST batch-delete matrix — items YES (array/keys/query body), schema (collections/fields/relations) NO (single-target only); collections DO have batch CREATE
metadata:
  type: reference
---

Directus REST batch support is **asymmetric by resource**:

- **Items — batch delete YES.** `DELETE /items/:collection` branches on the body (`controllers/items.ts:247`): a bare array `[k1,k2]` → `service.deleteMany(keys)`; `{ keys: [...] }` → `deleteMany`; `{ query: {...} }` → `deleteByQuery`. Single-item is the separate `DELETE /items/:collection/:pk`. SDK: `deleteItems()`.
- **Schema (collections / fields / relations) — batch delete NO.** Only single-target routes: `DELETE /collections/:collection`, `DELETE /fields/:collection/:field`. No array form.
- **Collections — batch CREATE yes.** `POST /collections` accepts an array → `collectionsService.createMany` (each entry may carry its own `fields`). So a collection batch-create helper is possible but a batch-delete one is not.

**Why:** came up on the blackbox db-error seed — the 4-collection cleanup must delete one-by-one (no batch route), while `CreateCollections` batch-creates. Also relevant to any "can I deleteMany?" — the answer is items-only.

**How to apply:** for item cleanup/mutation use the batch DELETE; for schema/DDL teardown, loop single deletes (respect FK order — child before parent). See [[project_directus_blackbox_batch_seeds]].
