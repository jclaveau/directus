---
name: project_directus_env_type_map
description: jean wants as many env vars as possible registered in the directus env TYPE_MAP (packages/env/src/constants/type-map.ts) — register every env var you touch/add with its EnvType, prefer parity when siblings are listed
metadata:
  type: project
---

**Register every env var you touch or add in `TYPE_MAP`** (`packages/env/src/constants/type-map.ts`), with its
`EnvType` (`'string' | 'number' | 'regex' | 'array' | 'json' | 'boolean'`). jean wants the coverage as complete as
possible — an env var missing from the map is a gap to close, not the norm.

**What TYPE_MAP is (and isn't).**
- It's the env layer's **runtime coercion registry** — `cast.ts` reads it to decide how to parse the raw string value
  (`getDefaultType(key) ?? guessType(value)`). A var absent from the map falls back to `guessType`, i.e. implicit/guessed
  coercion rather than declared intent.
- It does **not** produce TypeScript types. `Env = Record<string, unknown>`, so `env[K]` is statically `unknown` for
  every key regardless. `EnvType` has no literal-union kind, so the map can never express e.g. `'memory' | 'redis'`.
- So registering a var is about **explicit declared coercion + consistency**, not about removing an `as`. A value that is
  genuinely `unknown → domain` still needs narrowing at consumption (a `switch`/typeof guard, not a cast — see
  [[feedback_ts_as_cast_smell]], [[feedback_trust_typed_boundary_no_recast]]).

**How to apply.**
- Adding/touching an env var → add a `KEY: '<EnvType>'` line, grouped with its siblings. Even a plain string gets
  `'string'` for explicitness (e.g. `CACHE_STORE: 'string'` — its siblings `CACHE_STATUS_HEADER`/`CACHE_TAGS_HEADER` were
  already listed; it was the lone gap).
- Prefix-family vars use a regex key (e.g. `'DB_CONNECTION_.+_PRIORITY': 'number'`).
- The `create-env.int.test.ts` "Defaults that have a type set is casted" test exercises the map — a default whose value
  already matches the declared type casts as a no-op.
