---
name: project_directus_system_data_stale_dist
description: Fork dev loop — edits to packages/system-data YAML need a dist rebuild; tsx dev api loads dist/index.cjs not the source, symptom = system-collection metadata (relations/fields) missing locally but present in prod
metadata:
  type: project
---

The fork's local dev api (`pnpm --filter @directus/api dev` = `tsx watch src/start.ts`) resolves `@directus/system-data` → `packages/system-data/dist/index.cjs` — the **BUILT artifact**, not the source YAMLs (`src/collections/collections.yaml`, `src/relations/relations.yaml`, `src/fields/*.yaml`). Editing a YAML has zero runtime effect until you rebuild.

**Why:** 2026-08-03, the admin cache-page filter showed `user_id` on `directus_cache_descriptors` as a plain text field locally but as a relation in prod. Root cause: `dist/index.cjs` was built **07-02**; the cache-stats system-data (collections + `user_id→directus_users` m2o + fields) was added **07-22/08-01** (PR #324). Prod rebuilds all packages on deploy; the tsx dev loop didn't. NOT a merge issue — a stale build.

**How to apply:** after any `packages/system-data/src/*.yaml` change, run `pnpm --filter @directus/system-data build` (then restart the api). Verify the fix via `GET /relations/<collection>` / `/fields/<collection>` returning the expected relation, or grep the new `dist/index.cjs`. Local dev api runs from source via tsx — see [[feedback_tsx_watch_no_respawn]] for restart mechanics.
