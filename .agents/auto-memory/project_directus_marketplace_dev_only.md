---
name: project_directus_marketplace_dev_only
description: Marketplace is kept but closed in production (#670, replacing #668); extension (re)load failures are non-critical from now on
metadata:
  type: project
---

2026-11-03 jean ruling: the Marketplace is not removed (#668 closed), it is closed in
production (#670): `/extensions/registry/*` → 404 when
`(getNodeEnv() || 'production') === 'production'`; `info.extensions.marketplace` hides it
in the app. Development keeps runtime install/reinstall/uninstall.

**Why:** in production extensions change only with a deploy (#627); runtime installs are a
development convenience.

**How to apply:** treat an extension (re)load failure as NON-critical — a developer can
restart. Do not add boot refusals, retries or hardening for reload paths; don't rank such a
review finding above 🟢. Relates to [[project_directus_extension_migrations_653]].

**Settled in the #670 review (2026-11-03, do NOT re-raise):**
- `PATCH /extensions/:pk` (enable/disable + reload) is ALSO 404 in production, behind the
  same gate (`refuseExtensionChangeInProduction`, name kept for the smallest diff); the app
  locks enable/disable with the `marketplace_production_locked` tooltip, like uninstall.
- `DELETE /extensions/:pk` stays open in production: it only cleans a row, nothing reloads.
- Gate is mounted in `app.ts` BEFORE authenticate and the cache, see
  [[project_directus_gate_routes_before_cache]].
- The 404 path comes from `originalUrl` minus the query (bare `/extensions/registry/`).
