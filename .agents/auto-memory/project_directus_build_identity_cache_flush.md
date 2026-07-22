---
name: project_directus_build_identity_cache_flush
description: PR #285 (MERGED) — flush the redis cache on boot when the build identity changes, so a code-only deploy self-heals; architecture + accepted design decisions (don't re-raise in a fresh review)
metadata:
  type: project
---

PR **#285** (MERGED into `v11.10.1-hhh-dev`, squash `33505d2dbe`). Closes issue #282.
`api/src/cache-build-identity.ts` (new) — `flushCachesIfBuildChanged(extensionManager)`
called in `app.ts` right after `extensionManager.initialize()` + `flowManager.initialize()`.

**Problem.** The response cache lives in external redis and survives a container swap. A
code-only deploy (an api extension or a core/fork reshaping change with **no migration
and no `directus/version` bump**) keeps serving the previous build's response shape until
`CACHE_TTL`. `flushCaches()` otherwise runs only from the migration runner; `getCacheKey`
only hashes `directus/version`, which the fork pins → nothing notices a logic-only change.

**Mechanism.** On boot, fingerprint the build and flush once when it changed:
- **Case A (extensions):** sha1 of every loaded **api-side** extension bundle (hook/endpoint/
  operation/bundle — `apiEntrypointFile`); app-only extensions excluded (never run server-side).
  Each content framed with a trailing `\0` so one bundle's end can't merge with the next name.
- **Case B (core/fork):** build id = `CACHE_BUILD_ID` (env override) → **baked git commit**
  (`__DIRECTUS_BUILD_COMMIT__`, injected by tsdown `define` in `api/tsdown.config.ts` from
  `SOURCE_COMMIT`/`RAILWAY_GIT_COMMIT_SHA`/`GITHUB_SHA`/`git rev-parse HEAD`) →
  `RAILWAY_GIT_COMMIT_SHA` (runtime) → `directus/version`. `typeof __DIRECTUS_BUILD_COMMIT__`
  guard: a string in a built dist, undefined in unbundled dev (never a ReferenceError).
- Fingerprint + a 30s flush-lock both stored in **`lockCache`** (`_lock` namespace) — the ONE
  layer `flushCaches()` does NOT clear, so the print survives the flush it triggers. Non-atomic
  get-then-set gate (mirrors `system-cache-lock`) → one flush per multi-instance deploy.
- Only acts when `CACHE_AUTO_FLUSH_ON_DEPLOY=true` (default) AND `CACHE_STORE=redis` AND
  `CACHE_ENABLED=true` (memory store boots empty; nothing survives, nowhere to persist).
- Whole body wrapped in try/catch → a redis error at boot logs a warn, never aborts `createApp`
  (it's awaited bare in `server.ts`).

**New env** (registered in defaults/type-map/env-stub AND `directus-variables.ts` for the
`_FILE` secret convention — [[project_directus_env_type_map]]): `CACHE_AUTO_FLUSH_ON_DEPLOY`
(bool, default true), `CACHE_BUILD_ID` (string, optional override, flagged `TODO(reviewer)` as
probably-overkill now the commit is baked).

**Accepted decisions — settled, do NOT re-raise:**
- **`defaults.ts` can't hold the baked commit** — it's a static literal in the separate
  `@directus/env` package; the SHA is only knowable at the api build. Hence `define` + a
  `resolveCoreBuildId()` resolution fn, not an env default.
- **Overlapping-deploy flush miss** (two deploys inside the 30s lock, single-instance later
  deploy) — accepted, bounded by `CACHE_TTL`; commented at the call site.
- **First-ever boot flushes once** (no stored print) — harmless, accepted.
- **dev-only raw exposure not unit-tested-beyond-parity** — mirrors `stack` (not the case here;
  that's the FK PR). N/A.

Related: [[project_directus_cache_namespaces]], [[project_directus_env_type_map]], [[feedback_lint_style_before_commit]].
