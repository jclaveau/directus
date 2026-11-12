---
name: project_directus_gate_routes_before_cache
description: A route gate (production 404, feature refusal) must be mounted in app.ts BEFORE app.use(cache), or a cached 200 is served through the closed route; found reviewing #670
metadata:
  author: Jean Claveau
  type: project
---

`api/src/app.ts` mounts `app.use(cache)` (~line 374) before the routers (`/extensions` ~406). A gate
inside the router (`router.use('/registry', refuseExtensionChangeInProduction)`) therefore runs AFTER the
response cache: a GET entry written by an old replica (rolling deploy, late write) answers 200 from
Redis on the closed route. `cache-build-identity.ts` flushes once per boot on a fingerprint change, but
that does not cover the rolling-deploy window.

**How to apply:** mount any "this route is closed" gate in `app.ts` ahead of the cache middleware, and
pin the mount with the `request()` helper in `app.test.ts` (full 404 body by equality). A mount-only
test on a hand-built `req` stays green when the `use()` line is deleted. Ranks 🔴 per
[[feedback_stale_cache_is_high_severity]]. Related: [[project_directus_marketplace_dev_only]].
