---
name: reference_directus_env_casting
description: how @directus/env types values — type-map (explicit/regex per key) then guessType fallback; process-env is ALWAYS cast (create-env:45); unmapped numeric env vars DO become numbers (the "stays string" assumption is false)
metadata:
  type: reference
---

`@directus/env` casting (`packages/env/src`):
- `cast(value, key) = castFlag ?? getDefaultType(key) ?? guessType(value)` → then `toNumber`/`toBoolean`/`toArray`/`tryJson`.
- `getDefaultType` matches the **anchored** `TYPE_MAP` (explicit keys + `^regex$` entries, e.g. `DB_CONNECTION_.+_PRIORITY`, and the pool/port entries added on PR #213).
- `guessType` heuristically casts numeric strings → `number`, **BUT skips values starting with `0`** (they fall to json/`tryJson`) — so `DB_..._PORT=08080` guesses to STRING, a real edge case that explicit type-map entries fix.
- `create-env.ts`: **process-env vars (line 45) are ALWAYS `cast()`** (guess fallback applies); `DEFAULTS` (line 23) are cast only if in the type-map, else left raw. → an unmapped numeric process-env var IS typed via guessType; the "unmapped env stays a string" assumption is **false**.

**Public surface:** only `useEnv` is exported. `cast` is internal (I exported it on PR #213 for the `env-inject` test extension to reuse — see [[reference_directus_bb_extension_imports]] for the dep it needs).

**Nested keys:** `DB_POOL__MAX` is one FLAT key cast by env; `getConfigFromEnv` then splits `__` → `{ pool: { max } }` (knex config path — can't rename, [[project_directus_db_connection_priority]]).
