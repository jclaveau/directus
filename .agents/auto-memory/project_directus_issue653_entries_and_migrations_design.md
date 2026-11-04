---
name: project_directus_issue653_entries_and_migrations_design
description: Issue #653 SETTLED design (2026-11-03) — bundle entries move from package.json to runtime factories (@directus/extensions/scalabus), extension migrations as defineMigrationEntry with date versions + bundle prefix + before/after-schema phase, migrate:latest --snapshot, EXTENSIONS_AUTO_MIGRATE; one PR; do not re-litigate
metadata:
  author: Jean Claveau
  type: project
---

Design round with jean 2026-11-03, all points ruled. Supersedes the "awaiting jean" list in [[project_directus_issues653_654_extension_design]]. Plan written, no code yet; edits wait for an explicit go.

**Rulings (SETTLED, don't re-raise)**
- Option B (core runner runs extension migrations), NOT A (copy into MIGRATIONS_PATH). Untrusted-code objection gone (#670 Marketplace dev-only, #667 package-only extensions).
- Only the bundle `entries` level leaves package.json; `type`/`host`/`partial`/`hidden`/`path`/`coverage` stay. ~~`source: {app?, api?}`~~ **DROPPED (C4 B, 2026-11-04, PR #673 review)**: the SDK build uses fixed `src/app.ts` / `src/api.ts`; don't re-add `source`.
- Factories in `@directus/extensions` subpath `./scalabus`, re-exported by `@directus/extensions-sdk/scalabus` (same split as upstream define*). Names = the UPSTREAM names under the `/scalabus` import, name first: `defineHook('audit', config)`, `defineMigration('20261103A-x', {...})`, plus `defineBundleApi([...])` / `defineBundleApp([...])` → `{ format: 'scalabus/1', entries }`. Upstream define* carry `@deprecated Use \`defineHook\` from \`@directus/extensions-sdk/scalabus\``. Never a `*Entry` suffix (2026-11-04 ruling below).
- Entry names read at RUNTIME: api names from the `api.js` import (once per load, fresh on reload, reused for registration); app names sent by the browser once at load. Jean rejected a generated `entries.json`.
- Stale app chunk: content hash of the generated chunk; tab-focus check → toast "refresh" only when the hash differs (api-only rebuilds don't change it).
- Migration versions keep the DATE: `defineMigrationEntry('20260212A-foo', …)` → `@consumer/domain:20260212A`. Global order by date (core before extension on the same date, then bundle name) — a migration targets the fork's schema state at its date; "core first, then extensions" was rejected.
- `phase: 'before-schema'` (default) | `'after-schema'`, never ignored. `migrate:latest --snapshot <path>` = core+before → schema apply (load-snapshot.ts already reads schema-sync layouts) → after. Without `--snapshot` and after-schema pending → run before, exit 1 naming them. No need to move the schema-sync dep into the fork; its data sync stays its own command.
- Disabled migration entry still runs (a).
- `EXTENSIONS_AUTO_MIGRATE` (bool, default false): watcher-triggered reload runs migrate:latest (before-schema only) before registering; boot refuses it with NODE_ENV production/unset or without EXTENSIONS_AUTO_RELOAD. No lock for multi-process dev ("developer mistake, don't over-engineer").
- No `.registry` refusal needed (upstream extensions have no migrations).
- Consumer moves existing versions with one-off SQL adding the prefix (date unchanged → order kept).
- MIGRATIONS_PATH: drop later, filed as #672 (after #653 lands).
- ONE PR for factories + migrations.

**PR #673 autoreview rulings (2026-11-04, SETTLED)**
- **Override-only rows (B3):** jean saw `directus_extensions` rows for app entries as a second source of truth. A code bundle's app entry has a row ONLY after an admin toggles it. No `POST /app-entries` route, no `type` column, no `syncAppEntries` (removed B1/B5/B7/B8/D4 and CodeQL #25's original route). The page merges the chunk's `bundleEntries` into the children.
- O1: `PATCH /extensions/<bundleRowId>/entries/<name>` upserts the row. O2 A: a code bundle skips the partial-bundle auto-disable. O3 A: api entry rows of a code bundle stay synced from `api.js` (upstream's model).
- 2026-11-04 CORRECTION (jean, after the `define<Type>Entry` rename shipped): jean had asked for a DIFFERENT IMPORT PATH (`/scalabus`) that KEEPS the upstream names `defineHook`, `defineEndpoint`, … — not renamed `*Entry` factories. RULED 2026-11-04: rename to the upstream names lands IN #673 before merge (3 A); upstream define* keep a `@deprecated` naming only the scalabus import (2 A, settles CodeRabbit CR3); defineBundleApi/App unchanged. **Why:** the subpath already separates the two; a second spelling of the same concept is noise ([[feedback_use_the_codebases_own_word]]).
- CodeRabbit never auto-reviews this fork: tick the `Trigger review` checkbox on its comment via the API (jean's ask). Its points go through the same autoreview loop.
- #12 B: the A3 refusal stays strict, `/^\d{8}[A-Z]-/`. A legacy `YYYYMMDD-x.js` file (no letter) is refused even when already applied. Don't loosen it to `[A-Z]?`: jean chose to have a consumer rename its files and rewrite `directus_migrations.version` in its deploy script before `migrate:latest`. That rewrite can't be a migration, because `listMigrations` refuses before any migration runs.
- C2 A: an app entry named like an api entry (`operation` exempt only when both sides are operations) → the generated entrypoint loads none of the bundle's app entries + `console.error('Bundle "x" names "audit" on both sides')`. Server can't check it: it never imports `app.js`.
- A3 A: a `MIGRATIONS_PATH` file without a `<YYYYMMDD><letter>-` date is refused naming it. A4 A: `migrate:up` refuses an after-schema migration ("run migrate:latest --snapshot"); server can't compare schema-sync dates (none recorded). C1: hand-written `{format, entries}` exports are validated like the factories. A2 (failed first install leaves no admin) = out of scope, dev mistake.
- D2: app imports the entry as `…/sources/index.js?chunk=<hash>`. B4: chunks written to temp + renamed. B6: disabled code bundle's app side not imported.
- Alert #25 dismissed "won't fix" via API (SameSite=lax + CORS off): see [[reference_directus_codeql_csrf_alert_new_route]].

**Go given (2026-11-03):** create branch `v11.10.1-feat/extension-entries-migrations` off fresh origin/v11.10.1-hhh-dev (own worktree; `extensions-migrations` is 305 commits stale), red tests first. After the PR opens: check whether a CI label is required, loop until CI green; if green with no open design question, run /pr-autoreview on it.
**Jargon:** jean asked "What do you call DDL?" — say "migration", not DDL, in design talk.

**Why:** a fresh session otherwise re-proposes options jean rejected (entries.json, core-first order, 0001A versions, two PRs, advisory lock).
**How to apply:** implement from the plan in this order; read this file before touching `packages/extensions` schemas, `manager.ts` load, or `database/migrations/run.ts`.
