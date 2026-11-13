---
name: project_directus_cache_tier_switches
description: Which cache tier has an on/off switch (only response + schema), per-tier naming jean chose (CACHE_RESPONSE, CACHE_PERMISSIONS); CACHE_RESPONSE with CACHE_ENABLED fallback DECIDED 2026-09-30
metadata:
  author: Jean Claveau
  type: project
---

`CACHE_ENABLED` never disabled all caching — upstream `cache.ts:137` gates only the response tier on it. Schema has `CACHE_SCHEMA` (default true; `get-schema.ts:39`, `services/fields.ts:87`, `relations.ts:71`). System Keyv (`cache.ts:166`) and permissions (`@directus/memory` `permissions` namespace, `permissions/cache.ts`, `withCache`) are always on; lock tier is coordination, not a cache.

Jean's ask (2026-09-30): env var per tier — `CACHE_RESPONSE` and `CACHE_PERMISSIONS`, bare nouns matching upstream `CACHE_SCHEMA` (fork's own switches end `_ENABLED`, bare-noun family chosen anyway).

DECIDED (jean, 2026-09-30, "keep CACHE_ENABLED as fallback for now"): `CACHE_RESPONSE` names the response switch, `CACHE_ENABLED` is its fallback; setting field `enabled` → `response`; done inside #583. Order stays setting → env → default:
```
setting {response:true}, CACHE_RESPONSE=false        → on
no setting, CACHE_RESPONSE=false, CACHE_ENABLED=true → off
no setting, CACHE_RESPONSE unset, CACHE_ENABLED=true → on
```
"for now" = dropping `CACHE_ENABLED` later is on the table.

DECIDED 2026-09-30: `CACHE_PERMISSIONS` is a FOLLOW-UP PR, not #583 ("renaming in CACHE_RESPONSE cleared the ambiguity"). Shape: `CACHE_PERMISSIONS=false` → `withCache` calls handler directly, env-only.

**Why:** `enabled` read as "all caching"; ops want per-tier control.
**How to apply:** register new vars in TYPE_MAP ([[project_directus_env_type_map]]), no default for `CACHE_RESPONSE` (unset must fall back). Related: [[project_directus_pr583_cache_settings]].
