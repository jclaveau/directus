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

**Iterating on the admin page without a rebuild (2026-08-12)** — jean: *"could you run it in dev mode to avoid requiring rebuild / restart for every change?"*. Put Vite in FRONT of whatever api is already running, instead of rebuilding the bundle the api serves:
- `cd app && API_URL=http://127.0.0.1:8155/ pnpm dev` → **http://localhost:8080/admin/...**, same data, same PG/Redis. `app/vite.config.js` proxies `'^/(?!admin)'` to `API_URL`, so every api call lands on 8155 while `/admin` is served from source with HMR.
- Works against ANY running api, including the built acceptance flavour — leave that process alone.
- Only APP changes hot-reload. An api change (`cache-events.ts`, a migration) still needs the 8155 restart.

**Acceptance/built flavour (2026-08-12)** — for Playwright (`tests/acceptance`), which needs the admin served BY the api (`BASE_URL/admin`), not Vite on :8080:
- **Which DB depends on what you are driving — MEASURED 2026-08-12, not guessed:**
  - **sqlite** (`DB_CLIENT=sqlite3 DB_FILENAME=/tmp/…​.db`) is enough for the API and the counts chart: entries, hits/misses/fills, purge attribution all work.
  - **Postgres is REQUIRED for the acceptance suite.** The latency percentiles use `percentile_cont(…) WITHIN GROUP` (PG-only), so on sqlite `/utils/cache/latencies` returns `[]`, every `*P50/95/99` bucket field is null, and all three specs fail in `beforeEach` — the chart canvases exist but never become visible. On PG all three pass. This is why `.github/workflows/acceptance.yml` runs a postgres service.
  - Redis is required either way (scoped purge needs `CACHE_STORE=redis`).
- Still port **8155**. `node directus/cli.js bootstrap` then `start`, after `pnpm run build` (needs a real `app/dist`).
- Seed traffic the way `.github/workflows/acceptance.yml` does (fresh `?e2e=$RANDOM` → miss+fill, bare repeat → hit, collection-less GETs → `missing_scope` anomalies) and wait on the stats drain, or the charts are empty and every assertion trips.
- Run: `BASE_URL=http://127.0.0.1:8155 ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm --filter tests-acceptance test:e2e` — the spec defaults `PASSWORD` to `''`, so a missing export shows as "Wrong username or password".
- **Rebuild app → RESTART directus** ([[feedback_rebuild_then_restart_served_stack]]).
- Boot warns `Collection "directus_cache_*" doesn't have a primary key column and will be ignored` for the fact tables — **expected**, they carry no surrogate key by design.

