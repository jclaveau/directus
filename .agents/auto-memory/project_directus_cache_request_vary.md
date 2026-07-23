---
name: project_directus_cache_request_vary
description: PR #289 (MERGED) — response cache key now folds request content-negotiation dimensions (language/content-type/headers); architecture + accepted decisions so a fresh review doesn't re-litigate. Closes #283.
metadata:
  type: project
---

PR **#289** (squash-merged into `v11.10.1-hhh-dev` 2026-07-23, `efcc1b5`, closes #283).
`api/src/utils/get-cache-key.ts` — `getCacheKey` folds request-derived dimensions so a
header-varying response isn't served across callers. All computed BEFORE the lookup, so
read (cache.ts) + store (respond.ts) key consistently.

**Dimensions.**
- **language** — ALWAYS on, no config. Normalized primary `Accept-Language` tag (highest-q,
  region-stripped: `fr-FR,fr;q=0.9` → `fr`), parsed off the header directly (not express's
  negotiator, to keep the key a pure fn of req). Folded ONLY when present → header-less
  requests keep the original key (backward-compatible, no fragmentation for non-i18n installs).
- **content type** — `CACHE_VARY_CONTENT_TYPES` (array, default `json,csv,yaml`) via
  `req.accepts(list)`. Default-on is cheap (browsers/SDKs collapse to json via `*/*`).
- **request headers** — `CACHE_VARY_REQUEST_HEADERS` (array, default empty) exact names or `*`
  globs; `CACHE_VARY_REQUEST_HEADERS_EXCLUDED` (array) extends the built-in glob denylist.

**Accepted decisions — settled, do NOT re-raise in a fresh review:**
- **Content-type list order is significant, NOT sorted** — see [[project_directus_cache_vary_order]].
- **`xml`/`html` deliberately EXCLUDED from the default** — browsers send `application/xml;q=0.9`
  in Accept, so `req.accepts` would route ALL browser traffic to an xml bucket, splitting it from
  api-client json on every install. Verified empirically. csv/yaml are safe (browsers never send them).
- **A glob canNOT override the denylist** — an explicit `x-forwarded-*` glob folds nothing; the
  escape is an EXACT name (documented "name one exactly to override"). Exact names bypass base +
  extra denylist (deliberate opt-in). `CACHE_VARY_REQUEST_HEADERS_EXCLUDED` scopes to globs only.
- **Default content-type changes every key once on deploy** — build-identity flush (#285) absorbs it.
- **`excludedHeaders` built unconditionally per request** (before resolveVaryHeaders' empty-guard) —
  micro-nit, negligible (BASE regexes module-compiled), left as-is.
- **Forget-proof follow-up = #290** (response-`Vary` secondary-key registry) — parked, not gated on.

**Denylist** = one glob list matched by the same `varyHeaderPattern` engine as user patterns
(jean: "why 2 const? why not x-forwarded-*?" — no parallel startsWith path). Railway coverage
verified vs docs: [[reference_railway_edge_headers]].

Related: [[project_directus_cache_vary_order]], [[project_directus_env_type_map]],
[[project_directus_build_identity_cache_flush]], [[feedback_directus_liquid_85_col]].
