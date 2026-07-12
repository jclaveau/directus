---
name: reference_directus_items_forbids_system_collections
description: Directus /items API rejects directus_* system collections (403 "Forbidden access to directus_* collections") — a custom system collection can't be read/filtered natively via /items
metadata:
  type: reference
---

The Directus `/items/<collection>` API **refuses any `directus_*` collection** — `GET /items/directus_cache_descriptors` → 403 "Forbidden access to directus_* collections". Holds even for a *custom* system collection you registered via `packages/system-data`.

**Why it matters:** a custom `directus_*` collection gets the data-model UI (fields, m2o relations, the filter builder) but its rows are NOT reachable through `/items`. So the standard "load + server-side relational filter via /items" pattern is unavailable — you must expose a dedicated `/utils/...` endpoint and (if you want the filter-builder UX) evaluate the emitted Directus filter **client-side** against the loaded rows.

**Where it bit:** PR #227 cache page — the filter builder is keyed to `directus_cache_descriptors`, but filtering had to run client-side (`filter-entry.ts` `matchesFilter`, incl. m2o `user_id.email` drill-in) because `/items/directus_cache_descriptors` 403s. See [[project_directus_cache_admin_page]].

**Escape hatch (not taken here):** rename the collection to a non-`directus_` (user) collection → `/items` works + native filter, but it then shows in the app's data-model as user data.
