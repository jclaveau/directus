---
name: project_directus_eager_module_imports
description: The four eager import chains that cost a Directus worker 21 MB of heap it never uses, each with its measured saving
metadata:
  author: Jean Claveau
  type: project
---

Traced with `module.registerHooks` + a `Module.prototype._compile` patch (see
[[reference_directus_ram_probe_harness]]), then each fix measured by patching `dist`.
Idle heapUsed, cumulative, planner-shaped schema:

| change | idle heapUsed | Δ |
| --- | --- | --- |
| baseline | 85.5 MB | — |
| auth drivers imported lazily | 74.6 MB | ‑10.9 |
| `rollup`/`rolldown`/plugins imported inside `generateExtensionBundle` | 72.5 MB | ‑2.1 |
| + `SERVE_APP=false` (already set on the planner's Api) | 68.6 MB | ‑3.9 |
| CLI command modules imported inside their `.action()` | 64.2 MB | ‑4.5 |

Total **‑21.3 MB heap / ‑39 MB RSS per worker**, source loaded 22.5 → 14.3 MB,
4920 → 4475 files.

- **`api/src/auth.ts` statically imports all five drivers** (plus the
  `auth/drivers/index.js` barrel, and `controllers/auth.ts` does it again). `local`-only
  deployments therefore load `samlify` → `@authenio/samlify-node-xmllint` (**4.06 MB in
  one string**), `node-forge`, `xpath`, `pako`, `node-rsa`, `@xmldom/xmldom`, plus
  `ldapjs`, `openid-client` and `jose`. `registerAuthProviders` is already async, so
  `getProviderInstance` can `await import()` per configured driver; the controller's
  module-level loop needs top-level await.
- **`extensions/manager.ts` imports `rollup` AND `rolldown`** at module scope for a
  function that only runs under `SERVE_APP`. The planner's Api sets `SERVE_APP=false`
  and still pays for both.
- **`cli/index.ts` imports every command module** to register them, so `start` pays for
  `inquirer`, `rxjs`, `joi`, `execa` and `liquidjs` (the `init` command).
- **`metrics/lib/create-metrics.ts` and `processes/lib/supervisor-snapshot.ts` import
  `pm2`** at module scope; `create-metrics` is reached from `database/index.js`, so
  every process loads it, pm2 or not. Lazily loading it in `create-metrics` alone
  changes nothing while `supervisor-snapshot` still imports it eagerly — fix both.
  **Measured 2026-09-10: +1.66 MB heap / ~1.5 MB RSS per worker**, 104 files,
  0.49 MB source, no native addon. Measure it in a *warm* process (express, knex,
  ioredis, pino, joi loaded first): cold, the same import reads as +14.5 MB RSS
  because V8 grows its code range and arenas on first real load and the trigger
  gets charged for all of it. pm2 is the smallest of the four chains here — a
  footnote, not a reason to restructure; the reasons to consolidate it are the
  three separate pm2 clients, the twice-declared `pm2_env` typing, and the
  unbounded `listApps()` that can hang on a dead daemon.

Still eager and worth a second pass (~2.5 MB more): `graphql` + `graphql-compose` +
`mnemonist` (1.46 MB, only needed on `/graphql`), `@sinclair/typebox` + `zod`
(0.74 MB, pulled by `@directus/types`'s barrel because the api imports two runtime
enums — `UserIntegrityCheckFlag`, `TransformationMethods`), `nodemailer` (0.46 MB),
`sanitize-html`/`postcss`/`htmlparser2` via `utils/md.ts` (0.45 MB), `async` via
`import-export.ts`, and `@redis/client` (423 files) loaded alongside `ioredis`.

**How to apply:** trace before cutting — the win is per-package source bytes, and the
parent chain says who to fix. This is the same lever as #435's per-function imports,
measured against RAM instead of boot time.
