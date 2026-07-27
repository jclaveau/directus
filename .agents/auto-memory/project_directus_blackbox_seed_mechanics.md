---
name: project_directus_blackbox_seed_mechanics
description: how blackbox seeds + relation helpers work, and the no-link trick for cache-invalidation tests
metadata:
  type: project
---

tests/blackbox seed mechanics (learned wiring cache.test relation coverage):

- **`seedDBStructure` runs automatically** — `tests/db/seed-database.test.ts` does `globby('**.seed.ts')`, imports each, and calls its exported `seedDBStructure()` first (sequencer orders it before the suites). A `*.seed.ts` that only exports `seedDBValues` (called by its own test's beforeAll) still needs structure from somewhere — it's this global runner. So adding collections/relations to a `seedDBStructure` is enough; nothing else wires it.
- **Structure is SHARDED per test file** — seed-database.test.ts maps each `X.seed.ts` → `X.test.ts` and only runs its `seedDBStructure` if that test file is `inShard` (`filesForShard`). So a test file that needs collections must have its OWN `X.seed.ts` (even a one-liner `export { seedDBStructure } from './other.seed'`) — else on a shard without the owning test, the collections don't exist → `CreateItem` 403s "no permission" (unknown collection). 2026-07-27 (#311): splitting m2o MAX_BATCH into `m2o-max-batch-mutation.test.ts` needed a sibling `.seed.ts` re-exporting `m2o.seed`'s `seedDBStructure`.
- **Re-running `seedDBStructure` twice on one shard must be idempotent** (two `.seed.ts` for the same collections can both land on a shard). Helper idempotency: `CreateCollection` + `CreateRelation` GET-first (skip if exists); **`CreateField` was NOT** — bare POST, server throws `InvalidPayloadError("… already exists in collection …")`. Can't fix server-side with a filter hook: `createField` does a `directus_fields` existence check + throw at `fields.ts:~382` BEFORE emitting the `fields.create` filter (~404). Made the helper **optimistically idempotent** instead — POST, and only on `400` + that message GET the existing field back (fast path = 1 POST; only a duplicate re-seed pays a GET). See [[project_directus_blackbox_flakes]].
- **Seed WRITES go through the no-cache instance** — `CreateItem` seeds via `getUrl` (cache server) but falls back to `getNoCacheUrl` (`PORT+50`, `CACHE_SCHEMA=false`, same DB) on a `403` schema-cache-lag; the no-cache server recomputes schema per request so a just-created collection is always visible (#308).
- **Relation helpers** (`@common/functions`): `CreateFieldM2O({collection,field,otherCollection})`, `CreateFieldO2M({collection,field,otherCollection,otherField})`, `CreateFieldM2M({collection,field,otherCollection,otherField,junctionCollection})`, `CreateFieldM2A({collection,field,relatedCollections[],junctionCollection})`. Targets must pre-exist (`CreateCollection`); junctions are created by the helper.
- **Field paths for deep reads**: m2m junction FK to target = `${otherCollection}_id` → `tags.${otherCollection}_id.*`; m2a → `blocks.item:${target}.*`.
- **No-link trick**: a join read is tagged with the target collection **from the query AST**, regardless of whether any rows are linked. So a cache-invalidation test needs NO nested-link payload — just warm `GET ...?fields=*,<relpath>` (HIT), `POST /items/<target>` a bare row, re-GET → MISS. Mirrors the existing "isolates" test shape.

See [[project_directus_scoped_cache_tag_derivation]] for why tag-from-AST holds, [[project_directus_blackbox_cache_local_repro]] for running it locally.
