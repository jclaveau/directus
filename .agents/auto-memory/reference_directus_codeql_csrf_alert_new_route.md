---
name: reference_directus_codeql_csrf_alert_new_route
description: CodeQL fails any PR adding a route behind app.ts cookie-parser (js/missing-token-validation, alert #25 open since 2026-05-23) — a design question, not a bug to fix; plus @deprecated JSDoc naming a package gets bundled into user extensions
metadata:
  author: Jean Claveau
  type: reference
---

CodeQL `js/missing-token-validation` (alert #25, `api/src/app.ts:297`, cookie-parser middleware w/o CSRF protection) is open on `v11.10.1-hhh-dev`. Every new handler mounted behind it (PR #673 `POST /extensions/app-entries`) shows as a NEW alert → `CodeQL` check red.

**Why:** seen on PR #673; it is pre-existing upstream, not caused by the route's own logic.
**How to apply:** don't chase it as a code bug; report it to jean as a design question (CSRF vs bearer-only auth) and keep watching the other checks. Don't wait on it for the rest of the loop.

Second gotcha (same PR): a `@deprecated` JSDoc that names `@directus/extensions-sdk` ends up bundled in user extensions → the blackbox bundle import failed on a path missing the `directus/` segment; keep package names out of JSDoc shipped in bundled factories.

See [[project_directus_issue653_entries_and_migrations_design]].
