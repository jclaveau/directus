---
name: reference_directus_bb_extension_imports
description: bb endpoint extensions resolve bare imports from the extension file's dir (not the api process) — import a workspace pkg only after declaring it in tests/blackbox/package.json, else the extension silently fails to load and its route 404s
metadata:
  type: reference
---

A blackbox endpoint extension (`tests/blackbox/extensions/<name>/index.mjs`) that `import`s a workspace package resolves it from the **extension file's location** upward, NOT from the api process. `@directus/env` resolves from `api/` but NOT from `tests/blackbox/` (not hoisted there).

**What bit:** `import { cast } from '@directus/env'` in the `env-inject` extension made the module throw at load → Directus skipped registering it → `POST /env-inject/set` returned **404 "Route /env-inject/set doesn't exist"** → every `setDirectusEnv`-driven test failed (5 suites), not an import error in the test log. The build phase (packages) succeeded, masking it.

**Fix:** declare the pkg in `tests/blackbox/package.json` deps (`"@directus/env": "workspace:*"`) + `pnpm install` (updates lockfile) so pnpm links it into `tests/blackbox/node_modules`. Verify with `cd tests/blackbox && node -e "import('@directus/env')"`.

**Note:** extensions normally get Directus internals via the CONTEXT arg (`{ services, env, getSchema }`), not imports — importing an internal pkg is the unusual path and needs the dep declared. See [[reference_directus_env_casting]], [[project_directus_db_connection_priority]].

**Mount path = the extension's own name.** An endpoint extension in
`tests/blackbox/extensions/<name>/` serves at `/<name>/…` — `/update-paths-probe/silent`,
not `/update-paths/silent`. Getting it wrong returns 404, which a status-returning route
surfaces as a clean assertion mismatch rather than a crash.

**Extension type matters for the build.** `"type": "hook"` / `"endpoint"` run the `.mjs`
source as-is; `"type": "bundle"` expects built `app`/`api` entries that nothing in this
suite produces. Two extensions cannot share module state, so when a hook must report to a
test, have it write rows into a seeded log collection and read that back over the API.

Both apply on top of [[reference_blackbox_extensions_are_global]]: react only to your own
collections and swallow your own failures, or you take unrelated shards down.
