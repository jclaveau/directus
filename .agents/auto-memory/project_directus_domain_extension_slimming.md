---
name: project_directus_domain_extension_slimming
description: How a consumer's domain extension api bundle went 13.5 MB → 1.86 MB, and the pnpm trap that made it look impossible
metadata:
  author: Jean Claveau
  type: project
---

Landed 2026-09-08 on the consumer's trunk (uncommitted). Three changes, all in the
consumer's domain extension:

1. **`knex` was value-imported** in 4 files (`export { Knex } from "knex"`,
   `import { Knex }`), though every use is a type position. That pulled `tedious`,
   `oracledb`, `mysql2`, `@azure/msal-node`, `sql-formatter`, `iconv-lite` — **5.8 MB**.
   `import type` / `export type` erases all of it.
2. **App-only re-exports sat in an api-reachable barrel**
   (an extensions-exports module re-exported `@directus/composables`
   and `defineTheme` from `@directus/themes`, plus `export * as DirectusTypes`). That
   dragged the Vue runtime *and compiler* (4 copies of vue), `@babel/parser`, `vue-i18n`,
   `@sinclair/typebox` — **~4.9 MB**. Nothing imported them and `app.js` is 263 bytes.
3. **`--external`** for the deps the host resolves at runtime, plus declaring `vue-i18n`
   (a shared i18n module calls `createI18n` server-side and it was only
   resolving through workspace hoisting).

13.54 MB / 2107 modules → 4.92 MB → **1.86 MB / 161 modules**. Measured in a real boot
with all 9 of the consumer's extensions, 3 reps identical: heapUsed 139.8 → 117.2 MB, RSS
316.6 → 286.6 MB per worker. Boot time unchanged.

**The trap:** `--external` exists only in the hhh-dev sdk. The consumer's trunk already pins every
`@directus/*` (and all 7 `extensions-sdk` consumers) to `v11.10.1-hhh-dev-dist`, so it
just works there. On a branch mid-repin to another fork branch it does not, and
**pnpm will not relink it**: `node-linker=hoisted` allows one version repo-wide, both
branch tarballs are `@directus/extensions-sdk@16.0.0`, and two installs plus a
`rm -rf` + reinstall all left the old files in place (mtime unchanged) while the
lockfile showed the new commit. Check the branch's pins before concluding the flag is
missing.

See [[project_directus_eager_module_imports]] for the same lever inside the API itself.
