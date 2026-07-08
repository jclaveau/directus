---
name: project_directus_blackbox_batch_seeds
description: prefer batch API ops in blackbox seeds — CreateCollections / CreateItem array bodies, fold fields into collection payloads; no batch collection DELETE endpoint
metadata:
  type: project
---

In `tests/blackbox` seeds, prefer batch API operations over one-request-per-entity loops (jean's preference, "use deleteMany/createMany in seeds").

**What's batchable (verified against the fork's routes):**
- **Collections** — `POST /collections` accepts an ARRAY → `collectionsService.createMany`. Use the `CreateCollections(vendor, { collections: [...] })` helper (`common/functions.ts`); each entry may carry its own `fields: [...]` so the collection AND its columns are created in ONE request. Fold what were separate `CreateField` calls into the collection payload.
- **Items** — `CreateItem` already forwards an array body to `/items/:collection` (Directus batches it). See [[project_directus_db_connection_priority]].
- **Fields/relations** — `CreateFieldM2O` etc. build a relation, so they can't fold into the collection POST; keep them as follow-up calls after the batch create.

**What's NOT batchable:** collections have only `DELETE /collections/:collection` (no array route), so seed cleanup stays one `DeleteCollection` per collection (FK child before parent).

**Helper shape:** `CreateCollections` + `CreateCollection` share `buildCollectionPayload` (fills defaults + prepends the PK field) — extracted because it now has 2 callers, not a one-shot. `CreateCollections` skips the GET-first idempotency the single helper does (seeds DeleteCollection first anyway).
