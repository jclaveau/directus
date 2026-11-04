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
- Only the bundle `entries` level leaves package.json; `type`/`host`/`partial`/`hidden`/`path`/`coverage` stay. Entry files are always `src/app.ts`/`src/api.ts`: the `source` option was DROPPED 2026-11-04 (C4 B), superseding option a.
- Factories in `@directus/extensions` subpath `./scalabus`, re-exported by `@directus/extensions-sdk/scalabus` (same split as upstream define*). Upstream define* get `@deprecated` JSDoc. Names: `define<Type>Entry(name, config)`, `defineBundleApi([...])` / `defineBundleApp([...])` → `{ format: 'scalabus/1', entries }`.
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

**Go given (2026-11-03):** create branch `v11.10.1-feat/extension-entries-migrations` off fresh origin/v11.10.1-hhh-dev (own worktree; `extensions-migrations` is 305 commits stale), red tests first. After the PR opens: check whether a CI label is required, loop until CI green; if green with no open design question, run /pr-autoreview on it.
**Jargon:** jean asked "What do you call DDL?" — say "migration", not DDL, in design talk.

**Why:** a fresh session otherwise re-proposes options jean rejected (entries.json, core-first order, 0001A versions, two PRs, advisory lock).
**How to apply:** implement from the plan in this order; read this file before touching `packages/extensions` schemas, `manager.ts` load, or `database/migrations/run.ts`.

**PR #673 autoreview rulings (2026-11-04)**
- B3/B7: override-only rows for a code bundle's app entries. No row → entry follows its bundle's `enabled`; a row only once an admin toggles it. App lists its app entries from its own chunk. Removes POST /app-entries, the `type` column (20261103A), CodeQL #25.
- B1: no unique (bundle, folder) index, fine (upstream has none).
- A3: a MIGRATIONS_PATH file without a `<YYYYMMDD><letter>-` date is refused.
- A4: `migrate:up` refuses when the next pending migration is after-schema, pointing at `migrate:latest --snapshot <path>`.
- C1: `readBundleEntries` validates a hand-written export like the factories do (unknown type, undated migration name refused).
- C2: same entry name on the api and app side of one bundle → refused.
- O1: `PATCH /extensions/<bundleRowId>/entries/<name>` upserts the override row. O2 A: a code bundle skips the auto bundle enable/disable sync. O3 A: api entry rows kept (synced from api.js like package.json).
- B4/B5/B6(A: disabled bundle skipped)/D2(A: entry url carries ?chunk=)/D4 go; A2 out of scope (dev mistake).
