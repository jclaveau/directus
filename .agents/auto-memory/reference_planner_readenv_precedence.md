---
name: reference_planner_readenv_precedence
description: In the planner, a platform env var (Railway) overrides the .env files for any key those files declare — but a key no file declares is dropped entirely.
metadata:
  type: reference
---

`readEnv()` (`packages/js-utils/src/env/load-env-files.js`) parses every file in the
resolved chain with `@dotenvx/dotenvx`'s `parse(src, { processEnv: { ...process.env } })`.
**dotenvx's `parse` prefers `processEnv` over the file's own value.** Probed directly:

```
file: PM2_INSTANCES=2   process.env: PM2_INSTANCES=1   →  parsed = "1"
```

So a Railway service variable beats `apps/directus/env/.env` *and* the per-service
`.env.<env>.cd.railway.<svc>` overrides — every file goes through the same spread.

**Two traps:**

1. **Only keys a loaded file declares reach `env`.** The returned object is built by
   iterating the parsed file entries; a platform var no file mentions is simply absent.
   That is why `directus.ecosystem.config.js` reads `process.env.API_CPU_PROFILE_DIR ||
   env.API_CPU_PROFILE_DIR` — `.env:110` has it commented out, so `env` never carries it.
2. **The file header says "Process env is not loaded by default".** That is about which
   *files* get discovered, not about value resolution, and it reads as the exact opposite
   of the real precedence. Do not trust it; probe.

**How to apply:** to change a pm2/env value on one Railway service without a deploy PR,
set it as a service variable — valid as long as the key already exists in some loaded
file. To introduce a *new* platform-only key, add it to a file too (or read `process.env`
explicitly in the consumer). Scope it to the service: only Api runs pm2
([[project_directus_planner_bo_no_pm2]]). Env-file expectations are pinned by
`apps/directus/env/directus.env.spec.ts`, which tests files only — a Railway override is
invisible to it, so the spec will keep asserting the file value.

## What prod's Api service actually sets (read 2026-09-15)

`railway variables -s Api -e production` carries these, and each one **shadows any
`.env` file that declares the same key** — editing the file for one of them is a
silent no-op:

```
DUMP_PM2_CONFIG = true
PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER = 10
PM2_INSTANCES = 1
ROLLDOWN_WORKER_THREADS = 1
```

`PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER` is the trap: base `.env` sets it to the
same 10, so the two agree today and the shadow is invisible — change the file alone
and nothing happens. Every other `PM2_AUTOSCALE_*` is file-only and edits take.
`ROLLDOWN_WORKER_THREADS` is deliberately here rather than in a file
([[project_directus_eager_module_imports]]): rolldown reads it through Rust
`std::env::var` when its native addon loads, and `readEnv` copies `process.env`
without writing back.

Check this list before editing a `PM2_*` value in `apps/directus/env/`.
