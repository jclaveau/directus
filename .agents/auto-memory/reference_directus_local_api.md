---
name: reference_directus_local_api
description: Local fork api lives on port 8155 (NOT 8055) per jean — jean's other work owns 8055. Set PORT/PUBLIC_URL in api/.env (file overrides process env in @directus/env); Vite app on :8080 needs API_URL to point at 8155
metadata:
  type: reference
---

Port **8155** = the local fork dev api (`api/src/start.ts` via `tsx watch`, branch `v11.10.1-feat/cache-hit-ratio`). **Do NOT use 8055** — jean's other projects own it (2026-08-03: I had it on 8055; jean corrected me to use a spare port and picked 8155).

**Config gotcha:** `packages/env/src/lib/create-env.ts:18` merges `{ ...processEnv, ...fileEnv }` — the `.env` FILE overrides process env vars. So `PORT`/`PUBLIC_URL` must be edited in `api/.env` (currently `PORT=8155`, `PUBLIC_URL=http://localhost:8155`); an `env PORT=8155` prefix on the launch command is silently ignored.

**Run:**
- API: `cd api && NODE_ENV=development npx tsx watch --ignore extensions --clear-screen=false src/start.ts` (no SERVE_APP; log `/tmp/opencode/directus-api-dev.log`). Kill the tsx watch PARENT to stop.
- App: `cd app && API_URL=http://127.0.0.1:8155 pnpm dev` — Vite on :8080 proxies to the API (`app/vite.config.ts` reads `API_URL`, defaulting to 8055 if unset).
- Boot gotcha: `api/src/extensions/lib/get-shared-deps-mapping.ts:17` unconditionally resolves `@directus/app` → needs `app/dist/index.html` (the real vite build, or a gitignored stub — the full `vite build` is OOM-killed in low-RAM dev, ~3GB free).
- Stale `tsx watch` zombie watchers (no children) can pile up from crashed boots; clean them by cwd (`/proc/<pid>/cwd` = the fork's `api/`).
