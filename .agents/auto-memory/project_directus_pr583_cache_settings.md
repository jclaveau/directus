---
name: project_directus_pr583_cache_settings
description: PR #583 (issue #567) — CACHE_ENABLED + 7 live-safe CACHE_*/SCOPED_CACHE_* knobs as shared setting `directus_settings.cache_settings` (REST /utils/cache/settings, MCP read/write_cache_settings, cache-page drawer panel); design, CI fixes, and the deep-review findings (staleness window when a node lags the switch) — read before touching it
metadata:
  author: Jean Claveau
  type: project
---

`cache_settings` JSON column on `directus_settings`, in `SHARED_SETTINGS_COLUMNS`; branch `v11.10.1-feat/cache-enabled-shared-setting`, worktree `.wt-cache-enabled-setting`, PR https://github.com/jclaveau/directus/pull/583 (`Refs #567`). Scope decided by jean: ONLY `CACHE_*` / `SCOPED_CACHE_*` knobs that are live-safe (no setting may be able to serve stale data).

**Design**
- Fields: `enabled` + `value_max_size`, `stats_max_bytes`, `audit_limit`, `audit_max_duration`, `scoped_max_index_globs`, `scoped_index_scan_count`, `scoped_index_ttl_factor` (≥1, else the scoped index expires before its entries → stale). `null` = fall back to env / built-in default.
- Left env-only ON PURPOSE: `CACHE_STATS_ENABLED` (admin toggle already live), `CACHE_AUDIT_ENABLED` (per-node by design), `CACHE_CONTROL_S_MAXAGE` (CDN keeps unpurged entries → stale), `CACHE_AUTO_PURGE*`, `CACHE_KEY_HASH_ENABLED`, `CACHE_VARY_*`, `CACHE_COMPRESSION_ENABLED` (orphan/stale).
- Two gates: `cacheEnabled()` = serve+fill; `responseCacheWanted()` = node holds a response tier at all. Per-node mirror re-read on the `sharedSettingsChanged` bus + `SHARED_SETTINGS_POLL_SECONDS` (30s) poll.
- Env off + setting on: `flushBeforeEnabling` (settings.create/update filter, registered BEFORE the guard) clears the response tier first; refused clear refuses the write.
- Resolved answer carries `{value, source: settings|env|default, fallback}` → panel "Reset to env: X" tooltip.
- MCP tools `read_cache_settings`/`write_cache_settings` (group `cache`, `readOnlyHint:false`); guard refusal = JSON-RPC `-32602` (`body.error`), NOT `result.isError`.
- Panel: number `v-input` emits `null` on unparsable text → would write a reset; fixed IN the panel (badInputFields → "Not a number: <field>"), not in shared `v-input`.

**CI lessons (first run)**
- Style gate MUST run against the base: `node scripts/lint-style-changes.mjs origin/v11.10.1-hhh-dev` (HEAD-only run missed a 99-col comment).
- Redis `CACHE_ENABLED` off→on write always 503'd: `clearCacheTargets` cleared a just-built tier before `isReady` (disableOfflineQueue) → it now `awaitStoresReady` first (5s bound; admin clear during outage takes 5s longer to fail).
- Bench / cache red = known #560 trunk ceilings, not this PR.

**2026-09-30 state:** ALL findings below FIXED (tests eb395d87f6 red-first, fixes b8ef3ba0c7), field `enabled` RENAMED `response` + env `CACHE_RESPONSE` (fallback `CACHE_ENABLED`, 3a41806e40), MCP write moved to group `cache_settings`, PR body rewritten. CI green except Bench / cache (#560) and Bench / purge scaling (branch predates trunk's `bench:purge-scaling` script — needs a trunk merge, jean's call). Open for jean: #12 reaper per-run budget (schema change), #24 MCP write stamp, `CACHE_PERMISSIONS` split ([[project_directus_cache_tier_switches]]).

**Later 2026-09-30 (resolved, supersedes "open for jean" above):** #12 DONE without schema change (run row `options` JSON stores `maxDurationMs`; reaper `reapCacheAuditRuns` judges each open run by its own budget, fallback live setting; any bb test asserting audit `options` must now expect `maxDurationMs: 600_000`). #24 DONE: stamp `setBy/setAt/setFrom` + `setByEmail` reusing `AutoscaleWriteSurface` ('admin' REST / 'mcp'); a client patch sending a stamp key is REFUSED (autoscale silently overwrites); a clear stores null, no stamp. `CACHE_PERMISSIONS` = separate follow-up PR (decided, not started). Bench / purge scaling is trunk-red too (37x commands, 14.66x collection purge, identical on trunk base) — not this PR. Shard 4 `cache-audit-under-pressure` 200-vs-503 = flake #580. Trunk merge (111 commits) rebased in; trunk replaced index glob patterns with home pins, so `scoped_max_index_globs` was REMOVED as dead; trunk's purge-read metric read `CACHE_ENABLED` directly → gated on `responseCacheWanted()` (D1); every remaining field now has an env var (`'default'` source dropped from the answer). Env-var commit 8fbd16ea99. Hover-hold factorized into `app/src/components/v-chart.vue` (options prop, null = build nothing, `drawn` event; ef49112e24), used by processes (3) + cache (2) pages; pgbouncer page still hand-rolls ApexCharts.
**Test trap:** a ttl-factor test using `1s × 1.5` ceils to 2 = same as default factor 2 → vacuous; use `2s` (1.5→3 vs default→4).

**Race found by bb (60e2429f17):** the `FOR UPDATE` transaction made the `settings.update` action (which publishes `sharedSettingsChanged`) fire BEFORE commit (`utils/transaction.ts` reuses the outer trx, #363) → peer re-reads the old row, stays stale until poll. Fix: `announceSharedSettings(column)` exported from `processes/lib/shared-settings.ts`, called after the commit. Any new shared-settings write wrapped in a transaction must do the same.

**Deep review (3 agents, verified) — findings as reviewed (now fixed, see above)**
HIGH:
1. Node whose mirror still says off (env off) builds no tier → its writes purge nothing while other nodes serve → stale up to TTL (48h prod). Chosen fix: under `CACHE_STORE=redis` EVERY node always holds the tier and purges; setting gates only serve/fill.
2. `readScopedCacheEpochs` returns `{}` while off → fill-guard skips reads in flight at the flip. Gate on `responseCacheWanted`.
3. `fetch-dynamic-variable-data.ts` reads filter-context from cache while off; gate the read too.
4. Migrations / `schema apply` CLI never seed settings → skip response flush (`cache flush` itself DOES seed; only fails when no setting stored).
5. `scoped_index_scan_count` / `scoped_max_index_globs` / `scoped_index_ttl_factor` / `audit_max_duration` need upper bounds (1e20 → every SSCAN fails, purges recorded-and-retried forever).
6. `flushBeforeEnabling` decides from the node's mirror (`cacheEnabled()`), must read the stored row.
7. Panel Enter on an untouched row sent `PATCH {field:null}` (reset) — `applyRow` must return unless edited.
MEDIUM: flush ran before validateAccess (anonymous PATCH /settings cleared cache before 403; also before guard refused autoscale part) → check accountability + whole guard first; lost update on concurrent PATCH (no lock); out-of-order mirror refreshes (generation counter); one bad stored field blocks every per-field write; `write_cache_settings` in read-only `cache` group → own group `cache_settings`; bb file's enabled-windows could hit the main bb server via its 30s poll → `SHARED_SETTINGS_POLL_SECONDS=86400` in bb `directusConfig`.
LOW: aria-labels, i18n keys, panel reload, `stats_max_bytes:false` mismatch, `{ttl:null}` 200, PR body still describes #581 (must rewrite, edit needs a go).

**Why:** stale-cache findings rank HIGH ([[feedback_stale_cache_is_high_severity]]).
**How to apply:** don't re-derive; a node lagging the switch is THE hazard — any new gate keyed on the mirror must still purge. Related: [[project_directus_cache_flush_offline_tiers_581]], [[project_directus_shared_settings_source_of_truth]], [[project_directus_cache_bench_gates_560]].

**Second deep review + CodeRabbit (2026-09-30 evening, all fixed, red-proven):** non-admin switch-on now 403 (was: skipped the clear → old entries served); `updateCacheSettings` clears BEFORE the FOR UPDATE trx and `markEnablingFlushed(trx)` makes the filter skip (a clear inside the lock outlasts idle_in_transaction 60s); deploy flush gated on `responseCacheWanted()` not serving (failed boot seed / event-less switch-on); serving-off marker set in EVERY purge mode (was scoped-only); `readAllSharedSettings` fallback only when `schema.hasColumn` says missing; panel request token + error clear. Left open ON PURPOSE (LOW): `PATCH /settings` can store a forged stamp; two first-ever concurrent writes on a DB with no singleton row; a refused env value reads as `source: env` with the built-in value. Declined: CodeRabbit's bb `getUrl` under TEST_LOCAL (harness-wide, 134 files). Acceptance "latency data absent" ROOTED: trunk deploy fill pause (e3339e4f33) opens on a FIRST boot too (Lua GET nil ≠ build) → every fill refused during the traffic step (hitP50 0, fillP50 0); acceptance.yml now sets CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX=0 (d832188771). Open question for jean: should a first-ever boot open the pause at all?
**Jean's ruling on the open items (2026-09-30):** a refused env value (e.g. `CACHE_SCOPED_INDEX_SCAN_COUNT=0`) must RAISE at boot and fail the deploy, not fall back silently to the built-in (supersedes the `acceptedEnvOr` fallback + "left open" LOW). He dislikes the `directus_settings` singleton-table design (bad DB design IMHO) — so the no-row double-create LOW is not worth patching, a design discussion instead. `CACHE_PERMISSIONS` follow-up: "fine".
**2-3 DONE (a823f7a25d):** `validateCacheSettingsEnv()` in `cache-settings.ts`, called in `app.ts` after `validateDurationEnv` (before listen): each rule's env fallback checked by `rule.accepts` (undefined skipped) → `logger.error` + `process.exit(1)`; `acceptedEnvOr` gone; `isByteSize` accepts a positive integer (digits env → number via guessType), spec got an integer branch. Worktree style gate: `lint-style-changes.mjs` dies on the symlinked node_modules → run `eslint -c eslint.style.config.js -f json` filtered to the diff's added ranges.
**Final review (ef99825790), jean 2026-09-30:** boot failing on CACHE_AUDIT_MAX_DURATION > 24h or an out-of-range scoped index variable is ACCEPTED ("fine") — don't re-raise. CACHE_STATS_MAX_BYTES=false arrives as string "false" (TYPE_MAP 'string') → fallback maps it to false. `graphql-ip-gated-read` shard-7 fails (a823, aa3505) were intermittent: green at d238ca811a.
**Naming (2026-09-30):** single-word locals renamed (b40cb8f88c); single-word callback/loop/function PARAMETERS (`row`, `field`, `value`, `event`, `definition`, `v-for="row in …"`) kept AS IS by jean's call — don't re-raise on this PR.
**Local app tests in the worktree:** build `packages/{composables,format-title,stores}` with `npx tsdown` first, then app vitest runs.
**MERGED 2026-09-30** as `cacf0a3696` (merge commit, head 36c5e6c11c). Only red at merge: Bench / cache Redis command ceilings (fill 11 vs 7, fan fill 445.78 vs 7) — the #560 trunk red, being fixed in e7550d7c; jean said merge anyway.
