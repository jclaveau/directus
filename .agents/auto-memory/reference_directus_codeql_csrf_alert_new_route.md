---
name: reference_directus_codeql_csrf_alert_new_route
description: CodeQL js/missing-token-validation (alert #25, app.ts cookie-parser) flagged every new route; jean dismissed it as won't fix on 2026-11-04 (SameSite=lax + CORS, no CSRF tokens); plus @deprecated JSDoc naming a package gets bundled into user extensions
metadata:
  author: Jean Claveau
  type: reference
---

CodeQL `js/missing-token-validation` (alert #25, `api/src/app.ts:297`, cookie-parser before `extractToken`, which reads the session cookie as the token) flagged every handler mounted behind it, so any PR adding a route got a red `CodeQL` check (seen on PR #673).

**Dismissed 2026-11-04 as "won't fix", on jean's call.** A cross-site attack is already blocked: a PATCH/DELETE needs a preflight, CORS is off by default, `SESSION_COOKIE_SAME_SITE` defaults to `lax`, and an HTML form can send only GET/POST.
**How to apply:** if the alert reopens, or a PR's CodeQL check goes red on that rule, point to this dismissal; don't add CSRF tokens. If a new POST route is reachable by a plain form, still check that the cookie's SameSite setting covers it.

Second gotcha (same PR): a `@deprecated` JSDoc that names `@directus/extensions-sdk` ends up bundled in user extensions → the blackbox bundle import failed on a path missing the `directus/` segment; keep package names out of JSDoc shipped in bundled factories.

See [[project_directus_issue653_entries_and_migrations_design]].
