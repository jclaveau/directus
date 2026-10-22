---
name: feedback_directus_bad_env_var_fails_boot
description: A badly defined env var must FAIL the boot (stop the deploy) with a message naming the variable and what is wrong with it — never fall back silently to a default or run on the refused value
metadata:
  type: feedback
---

A badly defined env var fails the boot: the process exits before it listens, so the deploy stops, and the log names the variable and what is wrong with it.

```
CACHE_SCOPED_INDEX_TTL_FACTOR=0.5
→ "CACHE_SCOPED_INDEX_TTL_FACTOR" Environment Variable is 0.5, which is not a number from 1 to 100.
→ exit 1, before listen (the healthcheck fails, the previous deployment keeps the traffic)
```

- Never read a refused value as the built-in default, never run on it.
- An UNSET optional variable is not "badly defined": it reads as its default.
- A value the variable legitimately arrives as must still boot (e.g. `CACHE_STATS_MAX_BYTES=false` arrives as the string `"false"` because TYPE_MAP types it a string; digits arrive as a number via guessType) — check how `@directus/env` casts it ([[reference_directus_env_casting]]) before writing the rule.
- Pattern: `api/src/utils/validate-env.ts` (`validateBooleanEnv`, `validateDurationEnv`) and `validateCacheSettingsEnv()` in `api/src/cache-settings.ts`, called in `app.ts` before `validateDatabaseConnection`. Ending the process after listen would pass the healthcheck and crash-loop behind it.

**Why:** jean, 2026-09-30 (PR #583): a silent fallback hides a misconfiguration; a failed deploy with a precise message is the expected behaviour. Tighter bounds that now refuse previously-running values (e.g. `CACHE_AUDIT_MAX_DURATION` > 24h) were accepted as "fine".
**How to apply:** any new or touched env var with a validity rule gets a boot-time check of this shape; review findings proposing "fall back to default on bad value" are wrong for this fork. Related: [[project_directus_pr583_cache_settings]], [[project_directus_env_type_map]].
