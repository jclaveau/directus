---
name: directus_issue498_cache_audit
description: Issue #498 cache audit (replay every live entry against the database) — settled design points, the two defects only a hand-run smoke caught, and the verdict vocabulary
metadata:
  author: Jean Claveau
  type: project
---

Issue jclaveau/directus#498 on branch `v11.10.1-feat/cache-audit`, based on
`v11.10.1-hhh-dev` at 0fc1af2a66. Surfaces: `POST /utils/cache/audit` (admin),
`directus cache audit [--json] [--purge] [--strict] [--limit N] [--user] [--collection]`
(exit 0 clean / 1 stale or drifted / 2 unreplayable under `--strict`), cron
`CACHE_AUDIT_SCHEDULE`, ignore globs `CACHE_AUDIT_IGNORE_PATHS`. Verdicts:
`fresh | stale | tag_drift | raced | time_varying | expired | unreplayable:<reason>`.

**Settled deviations from the issue text (don't re-raise):**
- Replay marker is an HMAC header `x-cache-audit-replay` (secret-derived), not
  `Cache-Control: no-store` + `CACHE_SKIP_ALLOWED` — the latter would let any
  client bypass the cache. `cache.ts` skips read+fill on it; `respond.ts` answers
  the derived tags in `x-cache-audit-tags` and records no stats.
- `CACHE_AUDIT_SCHEDULE` is a cron, not an interval (every other schedule is).
- A replay 403 is `stale` (`reason: replay_status_403`), not unreplayable: the user
  would be served a 403 today instead of the entry.
- The replay JWT carries `app_access: false, admin_access: false` — `verifyAccessJWT`
  REQUIRES those claims present and recomputes both from the DB anyway.
- `purge: true` evicts per entry (`evictCacheEntry(redisKey)`), only stale/tag_drift.
- No MCP tool yet.

**Defects only the hand-run smoke caught (unit + bb suites were green):**
1. The CLI boot answered its own loopback replays `503 Under pressure`:
   `PRESSURE_LIMITER_ENABLED` defaults true and the event loop that just booted
   samples saturated for the first 250ms windows. `cli/run.ts` now disables it for
   `cache audit` next to `CACHE_AUTO_FLUSH_ON_DEPLOY=false`. A live node under
   real pressure still yields `unreplayable:status_503` — honest, retry next tick.
2. A `no_descriptor` finding rendered `user public` — unknown ≠ public; `-` now.

**Why:** the audit replays through the same process that serves it, so every
boot-time or load-time guard of the API (pressure limiter, deploy flush) turns
into a self-inflicted audit failure; a bb suite warms the loop before auditing and
never sees it.

**How to apply:** for any future self-replaying job in the CLI, gate the API's
self-protection in `cli/run.ts` before `createCli()`, and always smoke the built
CLI once by hand (`curl -g` for `[`/`]` in URLs) — see
[[project_directus_blackbox_cache_local_repro]] for the redis+sqlite hand-run
recipe and [[reference_directus_useenv_mock_hoisted]] for the env mock pattern.
