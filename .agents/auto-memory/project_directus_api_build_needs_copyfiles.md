---
name: project_directus_api_build_needs_copyfiles
description: running `tsdown` alone in api/ wipes dist's copied .yaml/.liquid/.md assets (it cleans by default), and bootstrap then dies with a misleading `SQLITE_ERROR: no such table: directus_migrations`
metadata:
  type: project
---

`api`'s build is **two** steps:

```
tsdown && copyfiles "src/**/*.{yaml,liquid,md}" -u 1 dist
```

`tsdown` **cleans `dist/` by default** (the script passes no `--no-clean`), so running it
alone deletes every asset the second step had copied. The next `node dist/cli/run.js
bootstrap` then fails with:

```
INFO: Installing Directus system tables...
INFO: Running migrations...
[Error: select * from `directus_migrations` order by `version` asc - SQLITE_ERROR: no such table: directus_migrations]
```

**Why:** 2026-08-17, iterating a local repro, I rebuilt with bare `tsdown` to save the
copy step. The error names migrations and sqlite, so I spent three runs suspecting my own
`flushCaches` change had broken the migration runner. Re-running the full build (tsdown +
copyfiles) fixed it immediately — the install step reads copied assets, not bundled code.

**How to apply:**
- Always run both halves. In a worktree without pnpm scripts wired up:
  `(node_modules/.bin/tsdown && node_modules/.bin/copyfiles "src/**/*.{yaml,liquid,md}" -u 1 dist)`.
- A bootstrap error mentioning a missing `directus_*` table right after
  "Installing Directus system tables" means the dist is incomplete, not that the DB or your
  diff is broken.
- Same trap for any local-repro loop that rebuilds between probes
  ([[project_directus_blackbox_cache_local_repro]]).

Related: [[project_directus_worktree_shared_node_modules]], [[feedback_no_ask_for_build_install]].
