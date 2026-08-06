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

**Helper shape:** `CreateCollections` + `CreateCollection` share `buildCollectionPayload` (fills defaults + prepends the PK field) — extracted because it now has 2 callers, not a one-shot.

**A folded field MUST carry `meta` (#336).** `createOne` builds the directus_fields rows from `payload.fields.filter((field) => field.meta)` (`api/src/services/collections.ts:165`), and `FieldsService.createField` has the identical guard — so omitting `meta` is a deliberate API capability meaning "bare column Directus does not manage": invisible to `GET /fields/:collection/:field`, and **absent from schema snapshots**, so it disappears when a collection is rebuilt via `POST /schema/apply`. `CreateField` never trips it because it defaults `meta` itself; hand-written folded literals do. The `FoldedField` type now requires it (`{}` normal, `null` = deliberate bare column) and `buildCollectionPayload` **throws** rather than defaulting — nothing runs the blackbox typecheck in CI, so the type alone would be decoration.

**`createMany` is ONE transaction** — a single duplicate collection rolls the whole batch back, with no per-item recovery from outside. `CreateCollections` therefore lists collections once (`GET /collections`) and drops those that already exist: one request for the whole batch, where the single helper's GET-probe costs one each.

**Batching escalates a lost field into a lost collection set.** One unserializable value in one folded field 400s all ten collections in the batch, where the per-field path lost only that field. Worth remembering when a batch fails wholesale — suspect one bad member, not the batch mechanism.

**Measured gain (#336):** slowest shard 8m17s → ~7m30s, sum of 8 ≈ −6%. Real but modest — seeding was never the bulk of a shard, and shard-to-shard variance is ±1min on identical commits. Don't quote a precise figure from one run.

Related: [[project_directus_blackbox_silent_write_failures]].
