---
name: project_directus_service_cache
description:
  Service-level read-through cache in ItemsService.readByQuery (PR #207 on v11.10.1-feat/read-through-cache) +
  CACHE_TYPES env; architecture, guards, and settled design decisions so a fresh review doesn't re-litigate them
metadata:
  type: project
---

Added a **service-level read-through cache** so any `readByQuery` caller (custom endpoint, hook, another service) caches — not only requests through the HTTP cache middleware. PR #207, branch `v11.10.1-feat/read-through-cache`, based on `fix/api-tsdown-externals` (which carries the scoped-cache feature; not in `main`).

**Architecture:**
- Mechanics live in `api/src/services/service-cache.ts` — `resolveServiceCacheKey` (guard + key, or null), `readServiceCache` (HIT, swallows read errors), `writeServiceCache` (max-size + dual `setCacheValue` + `tagScopedCacheKeys`). `readByQuery` only orchestrates (~15 lines). See [[feedback_no_one_shot_helpers]] cohesive-module exception.
- **Dual-write, NOT unified.** HTTP fast-path (`cache.ts` middleware HIT + `respond.ts` SET) is untouched. Service cache uses its OWN key namespace (`getReadThroughCacheKey` in `get-cache-key.ts` = HTTP key signals minus URL `path`, collection stands in). The two hold different shapes (raw items vs shaped response) so they must not share a key. Unifying would kill the fast-path (cached GET would re-run controller+shaping every hit).
- Purge unchanged: service key is `tagScopedCacheKeys`-indexed, so mutations drop it via the existing scope tags.

**Guards (`resolveServiceCacheKey`, all must hold):** `opts.cache !== false` (per-call opt-out, default on) + `CACHE_ENABLED` + `isCacheTypeEnabled('service')` + `cache !== null` + `!knex.isTransaction` (uncommitted) + `!isSystemCollection` (**security: permission/policy/field reads stay fresh via the system cache**) + `permissionsCachable` (no `$NOW`) + under `CACHE_VALUE_MAX_SIZE`.

**CACHE_TYPES config:** `CACHE_ENABLED` = master switch + the only thing that CREATES the Keyv store (`cache.ts:60`). New `CACHE_TYPES` array (default `'api,service'`) selects consumers: `api`=HTTP cache, `service`=read-through. Registered in all 3 env files: `defaults.ts`, `directus-variables.ts` (allowlist), `type-map.ts` (`'array'`). Gate helper `isCacheTypeEnabled` in its own util `utils/is-cache-type-enabled.ts` (NOT `cache.js` — else ~10 test files that mock `cache.js` would need to stub it).

**BUG fixed on this branch — hit-path tag re-propagation (`fix(api/cache): re-propagate scope tags on a service-cache hit`):** the read-through HIT originally returned `withMeta(cached, { scopedCacheTags: [] })`. But an HTTP/GraphQL response shaped ON TOP of a service HIT is tagged in `respond.ts` from that meta — so an empty list left the HTTP entry under NO scope tags → a mutation purged the service key but not the HTTP entry → stale HTTP response until TTL (desyncs when a service HIT backs an HTTP MISS: multi-URL→same service key, or REST-warmed→GraphQL read). Fix: `writeServiceCache` stores a TTL-matched `${key}__tags` sibling; `readServiceCache` returns `{records, tags}`; the hit returns the stored tags. A hit whose `__tags` sibling is evicted → treated as a MISS (self-heals). **General gotcha for dual-write caches: when layer B derives its invalidation tags from layer A's read result, A's cache-HIT path must re-propagate the same tags it set — returning `[]` silently un-tags B.**

**Settled decisions — do NOT re-raise in review:**
- Dual-write over unify (keep fast-path) — deliberate.
- System collections excluded from service cache — security, intentional.
- TTL shared (`CACHE_TTL`), not a separate `SERVICE_CACHE_TTL` — deferred, out of scope.
- GraphQL still whole-response via middleware (rides `api`), not folded per-resolver — out of scope.
- `isCacheTypeEnabled` in own util not `cache.js` — deliberate (mock-surface).

**Still OPEN (jean to decide):** default `CACHE_TYPES=api,service` (service on) vs `api`-only (service opt-in). Also whether specific internal user-data callers (flows, websocket reads, item-read op) need explicit `{ cache: false }`.
