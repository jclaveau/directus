---
name: project_directus_processes_metrics_gap_661
description: Processes admin page vs express-status-monitor — what the page lacks (event-loop lag, HTTP traffic, load average; issue #661) and that the fork's debug-level DB-error log supersedes a log-errors hook
metadata:
  author: Jean Claveau
  type: project
---

Fork processes page (`GET /utils/processes`, `packages/types/src/processes.ts`) covers CPU, RSS/heap/external, restarts, execArgv/env, autoscale panel, all processes (even dead ones), admin-only. It does NOT have: load average, event-loop lag, response time, requests/s, status-code classes. Filed as jclaveau/directus#661 (event-loop via `monitorEventLoopDelay`/`eventLoopUtilization`, `http` block counted in one `res.on('finish')` middleware, percentiles, per-interval figures, same `stats` permission). A consumer drops its `express-status-monitor` hook once #661 lands.

Database errors: fork-only `extractDatabaseError` (`api/src/database/errors/translate.ts:67`, from #288) debug-logs the raw driver error ("Translated database error") on write sites AND the error handler, so `LOG_LEVEL=debug` supersedes a `database.error`-filter logging hook. No single switch for DB-error logging alone; decision: debug level is fine, a `warn`-on-env-var switch would be a small change if ever wanted. `request.error` is covered by the error handler (non-Directus errors at `error`); websocket error/auth-failure logging was not checked.

**Why:** a consumer's two dead hooks were removed on this reasoning (2026-11-02); the comparison took several turns.
**How to apply:** before adding any HTTP-metrics or DB-error logging, read #661 and `translate.ts`; an extension hook loads only as a package dependency (#667: `EXTENSIONS_PATH` is refused at boot), see [[project_directus_extensions_packages_only_667]]. See also [[reference_directus_load_and_infra_nets]].
