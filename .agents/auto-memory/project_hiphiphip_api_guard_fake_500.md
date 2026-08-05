---
name: project_hiphiphip_api_guard_fake_500
description: bo.hiphiphip.app (planner prod, directus fork) returns FAKE 500s on every /items/* request whose Origin/Referer isn't in API_GUARD_ALLOWED_ORIGINS — an intentional anti-hacker middleware, NOT an outage. Source: @jclaveau/directus-extension-api-guard in planner_2/packages/directus-extension-api-guard/src/api-guard.js
metadata:
  type: project
---

## Fake 500s on bo.hiphiphip.app when the referer is wrong (NOT an outage)

The planner prod Directus (`bo.hiphiphip.app`, our fork) runs the **`api-guard`** extension:
`planner_2/packages/directus-extension-api-guard/src/api-guard.js`
(symlinked/bundled into the prod directus API; name `@jclaveau/directus-extension-api-guard`).

Behavior (a Directus hook filter on `authenticate`, so it runs BEFORE cache middleware):
- Only guards request paths matching `^/items/`.
- Computes origin from the `Origin` header, falling back to the `Referer` header
  (`protocol + '//' + host` via `url.parse`).
- Skips the guard entirely when `HHH_ENV?.startsWith('.env.dev')`.
- If `origin` is missing **or** not listed in `API_GUARD_ALLOWED_ORIGINS` → logs the attempt and
  `throw new Error('INTERNAL_ERROR')` → Directus surfaces a generic 500
  (`{"errors":[{"message":"An unexpected error occurred.",...}]}`). Deliberately opaque — scares off
  scanners/hackers; the error looks exactly like a real server crash.
- Env wiring: `apps/directus/env/.env.prod.cd.railway` →
  `API_GUARD_ALLOWED_ORIGINS="https://${RAILWAY_Frontend_PUBLIC_DOMAIN},https://${RAILWAY_PUBLIC_DOMAIN}"`.
  Dev local: `http://localhost:8055` etc.

## Consequences for probing prod with curl (verified empirically 2026-08-01)

- curl sends NO `Origin` and NO `Referer` → `origin` is falsy → EVERY `/items/*` request gets a fake 500:
  real collections, internal `directus_permissions`, even `/items/nonexistent_collection` (guard throws
  before the 404 routing). NOT a collection bug, NOT a cache problem.
- Non-`/items/*` routes work fine: `/users`, `/roles`, `/activity`, `/settings`, `/collections/:name`,
  `/fields/:collection`, `/relations/:collection`, `/utils/cache`, `/server/*` → 200.
- Bypassing the cache (`Cache-Control: no-store`, `no-cache`) does NOT help — the guard is at
  `authenticate`, before caching. HEAD requests are guarded too.
- To read item data / cache contents from a script you MUST send a real browser-ish header, e.g.
  `Origin: https://<frontend-domain>` or `Referer: https://<frontend-domain>/` matching an allowed origin.
  The prod allowed origins are the Railway frontend + API public domains (hiphiphip.app family).

## Trap: diagnosing a real prod incident

If prod `/items/*` starts 500ing, check the api-guard FIRST: is the failing client sending a legit
Origin/Referer? A "all custom collections are down" signature with internal routes healthy is almost
certainly this middleware, not a real outage.
