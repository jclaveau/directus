---
name: project_directus_extensions_packages_only_667
description: Extensions load only as package deps (#667 merged, EXTENSIONS_PATH refused at boot); registry removal #668 closed → #670; blackbox fixtures are ONE bundle with fan-out entries; two PRs adding the same migration version collide
metadata:
  author: Jean Claveau
  type: project
---

**State (2026-11-03):** #667 merged (d28904c2df) — the local `EXTENSIONS_PATH` folder source is gone;
`validateUnreadEnv()` (`api/src/utils/validate-env.ts`) refuses `EXTENSIONS_PATH` at boot, naming it.
Migration `20261102A` deletes `source='local'` rows. #668 (delete the registry) was CLOSED, replaced by
#670 (Marketplace closed in production only, see [[project_directus_marketplace_dev_only]]).
Sources left: `module` + `registry`. Feeds [[project_directus_extension_migrations_653]].

**Blackbox layout after #667:** one bundle package `tests/blackbox/extensions/` (`link:` from
`tests/blackbox/package.json`), two fan-out entries `hooks.mjs` / `endpoints.mjs` that `readdir` their
folders at load (no list to maintain; a folder without `index.mjs` throws naming it).
`extension-settings-probe` stays its own package (toggling its row must not disable the bundle).
Spawned instances: `tests/blackbox/utils/write-extension-package.ts` (temp package + `PACKAGE_FILE_LOCATION`).
Perf: `tests/perf/extension-package.ts`. Follow-up that removes the fan-out files: issue #666.

**Gotchas:**
- Settings takeover (package-name row → folder-name row, upstream v10.10 fix-up) was deleted: local-only, rows deleted by the migration.
- Two stacked PRs each adding `20261102A` collide; the second renames to `B` on rebase.
- Env var that becomes a boot refusal also breaks Bench until trunk `bench.yml` drops it: see [[project_directus_bench_measures_trunk]].
- Agent doing `git add` over already-deleted paths aborts → a commit of deletions only that does not build alone (squash hides it).

**Why:** jean wants each step in a dedicated PR "so we can roll it back".
