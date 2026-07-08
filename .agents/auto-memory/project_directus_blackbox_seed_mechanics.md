---
name: project_directus_blackbox_seed_mechanics
description: how blackbox seeds + relation helpers work, and the no-link trick for cache-invalidation tests
metadata:
  type: project
---

tests/blackbox seed mechanics (learned wiring cache.test relation coverage):

- **`seedDBStructure` runs automatically** — `tests/db/seed-database.test.ts` does `globby('**.seed.ts')`, imports each, and calls its exported `seedDBStructure()` first (sequencer orders it before the suites). A `*.seed.ts` that only exports `seedDBValues` (called by its own test's beforeAll) still needs structure from somewhere — it's this global runner. So adding collections/relations to a `seedDBStructure` is enough; nothing else wires it.
- **Relation helpers** (`@common/functions`): `CreateFieldM2O({collection,field,otherCollection})`, `CreateFieldO2M({collection,field,otherCollection,otherField})`, `CreateFieldM2M({collection,field,otherCollection,otherField,junctionCollection})`, `CreateFieldM2A({collection,field,relatedCollections[],junctionCollection})`. Targets must pre-exist (`CreateCollection`); junctions are created by the helper.
- **Field paths for deep reads**: m2m junction FK to target = `${otherCollection}_id` → `tags.${otherCollection}_id.*`; m2a → `blocks.item:${target}.*`.
- **No-link trick**: a join read is tagged with the target collection **from the query AST**, regardless of whether any rows are linked. So a cache-invalidation test needs NO nested-link payload — just warm `GET ...?fields=*,<relpath>` (HIT), `POST /items/<target>` a bare row, re-GET → MISS. Mirrors the existing "isolates" test shape.

See [[project_directus_scoped_cache_tag_derivation]] for why tag-from-AST holds, [[project_directus_blackbox_cache_local_repro]] for running it locally.
