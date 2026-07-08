---
name: project_directus_pr205_accepted_exceptions
description: PR #205 scoped-cache-value-tags — points jean explicitly accepted/settled during review; do NOT re-raise these when reviewing #205 or its follow-ups in a fresh session
metadata:
  type: project
---

Settled during the #205 review (branch `v11.10.1-feat/scoped-cache-value-tags`). A fresh review would wrongly re-flag these — they are **closed, do NOT re-raise**:

- **Large PR scope is ACCEPTED.** #205 bundles the value-scope cache feature + the full Prettier removal + eslint.style migration + eslint-rule fixes across ~46 files. Jean signed off on the big scope; don't propose splitting it. (General: [[feedback_refactor_minimum_diff]] does NOT apply here — scope was a deliberate call.)
- **String/number collapse INTENTIONAL, but non-string scalars now TYPE-NORMALIZED (2026-07-02)** — `7`/`"7"` → same key on purpose. BUT the deep review found plain `String()` diverges for boolean/date/decimal (filter vs DB row) → superseded by `canonicalScopedCacheValue(value, type)` + a `ScopedCacheTag.type` rider. So don't re-propose "normalize by type" (done) NOR "just use String everywhere" (wrong for bool/date/decimal). NULL → `\x00null` sentinel. [[project_directus_scoped_cache_value_hardening]].
- **Pure-aggregate reads bare-tagged = NOT a bug** — `count(*)` field map still contains root (`getInfoForPath` inserts it unconditionally) → bare tag → invalidated on write. Verified + blackbox-guarded. Don't re-flag "aggregate never purged / stale".
- **Reader/writer cache race = DEFERRED (pre-existing)** — reader caching a stale value between a writer's `smembers` and `redis.del(tagKey)` orphans the entry till TTL. Exists in upstream `cache.clear` model too; value-slicing shrinks blast radius. Out of scope for #205 (needs a broader cache-race design). Don't re-raise as a #205 defect.
- **`parseJsonFieldList` silent degrade = INTENTIONAL** — malformed `cache_scope_fields` → `[]` → sound bare-tag fallback. A `logger.warn` was declined (would break the pure util's testability / risk per-rebuild spam). Don't re-flag.
- **Relations stay BARE-tagged by design** — a join-read tags the joined collection bare (no value slice); a write to it purges all reads joining it (coarse over-invalidation). This is deliberate, not a coverage hole. Per-relation value-scoping = the `cache.scope`/`cache.purge` filter pair in userland, explicitly out of scope for core. PARKED for the planner ([[project_scoped_cache_planner_adoption]]). Don't re-flag the "sibling survives" test gap — it's invalid by design.
- **`CACHE_TTL` unbounded-tag-sets risk = FALSE ALARM** — default is `5m` (`packages/env/src/constants/defaults.ts`), so tag sets self-expire; only an operator explicitly setting `CACHE_TTL=false/0` disables it, at which point the whole cache is unbounded by their choice. Not a scoped-cache defect. Don't re-raise.
- **`$CURRENT_USER` pin = VERIFIED SAFE** — resolved by `sanitizeQuery` before the service; not stale. [[project_scoped_cache_planner_adoption]]. (Suspected twice, now pinned by a blackbox test — [[feedback_retracted_bug_needs_regression_test]].)

Addressed (not exceptions, just done): updateMany now re-reads committed rows (not payload); Redis cluster rejected at startup (`assertScopedCacheRedisSupported`); blackbox witnesses added (purge-fired + spared control + cross-collection). See [[project_directus_scoped_cache_value_hardening]].
