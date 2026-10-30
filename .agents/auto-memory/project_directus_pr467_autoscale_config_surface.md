---
name: project_directus_pr467_autoscale_config_surface
description: PR #467 (stacked on #456) makes the autoscale override readable and writable — bus read-back through the process report, sparse field-level PATCH, an admin panel with a load drill and a rolling pm2 restart, editable supervisor (pm2) options, and the first MUTATING system-mcp group
metadata:
  author: Jean Claveau
  type: project
---

Branch `v11.10.1-feat/autoscale-config` → PR **#467**, based on
`v11.10.1-feat/autoscaler` (#456). Four commits: report the tick, HTTP surface,
MCP tools, GUI.

**The autoscaler is not HTTP-reachable.** `runAutoscaler` is its own pm2 app beside
the pool, so no request lands in the process that resolved the configuration. The
read-back channel is the one it already answers: `api/src/autoscale/index.ts` calls
`initProcessReports()`, so every tick's resolved config, per-field source, pool
counts and last decision ride on `ProcessNode.autoscale` in the same
`GET /utils/processes` report the page already reads. **Never recompute the
effective config in the request that serves the page** — that api worker has a
different environment.

**Writes are sparse, per field.** `withOverride` merges the Redis JSON field by
field and `continue`s on anything the base config has no key for. So:
- a field absent from a PATCH keeps resolving through the env chain,
- `null` deletes the field from the override,
- `setBy` / `setAt` / `note` ride in the same flat JSON with zero reader change
  and no migration.
A whole-object write would pin all 13 fields and kill the env chain — don't.

**Bounds live in one table**, `AUTOSCALE_BOUNDS` / `SUPERVISOR_BOUNDS` in
`@directus/constants` — values, not types, so the app holds them at runtime.
`sanitizeConfig` clamps by it (`maxWorkers`→[1,64], then `minWorkers`→
[1,maxWorkers], `releaseCpuThreshold`→[0,scaleCpuThreshold-1]),
`assertUsableConfig` refuses by it, and the panel's inputs offer it.

**The override key is fleet-wide** (`<CACHE_NAMESPACE>:config:processes:autoscale`): one
write moves every node in the namespace.

`GET|PATCH|DELETE /utils/autoscale`, admin-only, mounted only under
`redisConfigAvailable()` — the app treats a **404 as "no Redis, this deployment is
tuned by its environment"**, not as a failure.

**`autoscale` is the first system-mcp group that writes** (`read_autoscale_config`,
`write_autoscale_config` with a REQUIRED `note`); every pre-existing group stays
read-only, and the group is filtered out where Redis is absent.

**Levers, in the order to reach for them at 3am:** pause (`enabled: false`), pin
(`minWorkers === maxWorkers` leaves `decide` no branch that returns a size),
`strategy: legacy`, clear the override.

Related: [[project_directus_pr456_autoscaler_design]],
[[project_directus_pr456_open_items]],
[[project_directus_worktree_shared_node_modules]] (how the app tests were run).

**CI at head `b1623f4d22`:** everything green — Check, Lint, Format, Stylelint,
Style (changes), CodeQL, all three unit jobs, and 8/8 blackbox postgres shards —
except the unflagged `codecov/patch`, inherited from #456's base rather than added
here ([[project_directus_codecov_aggregate_patch_gate]]). The slice's own files
measure well: `tools.ts` 100%, `state.ts` 100%, `autoscale-panel.ts` 100%,
`autoscale-panel.vue` 96.2%, `override.ts` 92.0%, `services/utils.ts` 63.9%. The
gap is still `api/src/autoscale/index.ts` at **0%** — the loop and bootstrap only
blackbox reaches, which the aggregate gate does not credit.

**Follow-up round, driven by preview screenshots (`4fccccc6d2`, `c0fa6cd35e`):**
- The preview never ran an autoscaler at all — `preview-admin.yml` only started the
  `directus` pm2 app. Fixed by starting a second app (`directus autoscale`) scaling
  the first, with preview-only pacing (`SAMPLE_WINDOW=3`, min 2/max 6, add 10s/
  release 30s, warmup 15s) so the panel shows real `env` values and the levers move
  something visibly. See [[project_directus_preview_infra]].
- A field nothing reports and nothing overrides was mislabelled `override`; fixed
  to `source: null` → renders `—`. Only a field the override JSON actually holds
  says `override`.
- The override input now carries `row.effective` as placeholder, visible exactly
  when empty (i.e. exactly when the value is the env's/default's, not the
  override's).
- **`processes.vue` now drops any process reporting no autoscale state** — a
  mid-rollout fleet with one un-upgraded replica on the bus was crashing the whole
  Processes page, not just hiding that node's panel row.
- Enum fields (`enabled`, `strategy`, `signal`) became `<select>` with a deselect
  option (clears to `null`), because free text silently fell back to a default on
  a typo (`scalabuss` → `scalabus`, no error). Numeric fields got
  min/max/step/unit mirroring `sanitizeConfig`'s own bounds (documented in a
  comment so it doesn't read as a second copy of the rules) — the `Running on`
  column is still what proves what actually applied.
- 89/89 tests green in the folder after the typed-inputs pass, 6/6 mutations
  caught. CI on `c0fa6cd35e` fully green except the same inherited aggregate gate.

**Panel iterated to its current shape over ~10 more rounds of screenshot-driven
feedback** (`f643af9c51` → `69786752fd`), each mutation-tested before push. Net
result — read this as "what's there now", not a changelog:
- No note input, no "fallback to legacy" button (redundant with the `strategy`
  select), no "Running on" column (the input itself shows the running/config value,
  placeholder = env default). "override" renamed to **"config"** everywhere.
- Each field: **tick** (apply) + **cross** (cancel draft) + **`settings_backup_
  restore`** (reset to env, tooltip names the value) grouped tight against the
  input. Selects lost `show-deselect` — reset is the dedicated third button.
- Colour means **unsaved**, not "came from config": value + source go
  `--theme--primary` while a draft is pending, nothing else is coloured.
- Value, unit and source live in **one box** (`v-input`/`v-select` `#append`
  slot), not separate columns. Number order left→right: value, unit-space,
  source, stepper arrows (`.control.numeric :deep(.append){order:1}`,
  `:deep(.arrows){order:2}`) — matched so a select's chevron sits at the same
  visual point as a number's arrows.
- Picking (not yet applying) `legacy` in the `strategy` select greys+disables the
  four fields it reads nowhere (`signal`, `sampleWindow`, `prewarmWorkers`,
  `warmupSeconds`) via `configRows(state, override, pendingStrategy)`.
- Bottom-of-form **Apply all / Reset all / Reset to env** buttons.
- **`setBy`/`setFrom` provenance**: `setBy` stays the durable user id in Redis;
  the read resolves it against `directus_users` and answers `setByEmail`
  (falls back to the id if the user is gone; a malformed hand-edited `setBy`
  is caught, not a 500). `setFrom: 'admin' | 'mcp'` stamped by the caller.
  Stamp reads "Configured by x@y.com from the system MCP 2d ago — note".
- **Server-side validation, not front-end**: `assertUsableConfig` in
  `api/src/autoscale/lib/validate-config.ts`, called from the one service method
  both REST and `write_autoscale_config` reach — so the MCP surface is held to
  the same rules. Judged on the **whole merged config** (env chain + override),
  not the patch, because a floor is only too high against a ceiling the patch
  never mentions. Rules: integers only; per-field bounds mirroring
  `sanitizeConfig`'s clamps but *refusing* instead of silently correcting;
  `minWorkers <= maxWorkers`; `prewarmWorkers <= maxWorkers`;
  `releaseCpuThreshold < scaleCpuThreshold` **strictly** (equal already breaks —
  add is skipped for room, release fires on the same reading, worker comes back
  next tick). Deliberately NOT refused: `minSecondsToScaleDown > …Up` (legitimate
  preference), `prewarmWorkers >= minWorkers` (floor wins anyway), `signal: max`
  (dangerous but a real choice). Blackbox-tested end to end incl. the MCP path
  answering JSON-RPC `-32602` with nothing stored.

**Load drill** (`8ffc49140d`) — a button to generate synthetic pool load so a
config tweak (threshold/cooldown/prewarm) can be watched actually deciding
something, since one HTTP request lands on one pm2 worker and can't move the
*pool* signal the autoscaler reads. Mechanism: broadcast on a `autoscaleDrill`
bus channel (same bus as `cache-config.ts`); every worker subscribes at boot
(`initAutoscaleDrill()`) and burns a clamped share of every 100ms slice until a
**self-held deadline** (not just "until told to stop" — a lost stop message must
not leave it spinning). Re-announced every 1s so workers the drill itself adds
join it. Safety: env-gated off by default (`PM2_AUTOSCALE_DRILL_ENABLED`, route
absent without it), admin-only, 120s hard cap, 10–95% duty (95 not 100 — a slice
with no idle never yields, so 100% would be an outage not load), refused
server-side when any worker is already at/above `releaseCpuThreshold`
(`loadedWorker()`). `MAX_DRILL_SECONDS`/`MIN_DRILL_PERCENT`/`MAX_DRILL_PERCENT`
and the pure `cappedDeadline`/`clampPercent` helpers are exported specifically so
a "runs for the cap" test doesn't have to actually spin 120s.

**Rolling pm2 restart button** (`39ca423908` + `69786752fd`) — see
[[reference_directus_pm2_reload_internals]] for the pm2-internals research this
is built on. Summary: `pm2.reload()` genuinely brings the replacement up before
retiring the old worker, *provided* `listen_timeout` exceeds boot time — the
fork's had been unset (pm2 default 3000ms) against a measured ~3.26s Directus
boot, so every reload was already silently degrading to stop-then-start; fixed
first (`8c6031222c`, `PM2_LISTEN_TIMEOUT` default raised to 15000). The restart
itself is asked for over a bus channel (`autoscaleReload`) from the api worker
requesting it, and *performed* by the autoscaler process (not a pool member,
already holds the pm2 supervisor connection) so the loop keeps ticking through a
multi-minute rolling restart. The loop is told to hold still during one:
`reloading() === false` gates both prewarm and the decision branch, because a
reload bumps `restart_time` (read as churn) and the old-worker-still-present
window makes `readPool` briefly overcount the pool — both look like "pool in
trouble" to the loop otherwise. Reload budget derives from the **declaration
being pushed** (`reloadBudgetMs`), not the previously-reported one, so raising
`listenTimeout` doesn't cut its own roll short.

**Editable supervisor (pm2 declaration) options** (`69786752fd` +
`aab10099e1`/`be1e0c0e52` for the blackbox coverage). Read-only "Supervisor"
table shipped first (`b0590c2629`, off `pm2_env` via `readPool`, not this
process's own env — the declaration is fixed at `pm2 start`, so a `PM2_*` edited
since is what the *deployment* holds and the pool does not); 6 of the 10 rows
(`listenTimeout`/`killTimeout`/`minUptime`/`restartDelay`/`maxRestarts`/
`maxMemoryRestart`) became writable once the reload button existed to actually
apply them — `instances`/`execMode`/`waitReady`/`autorestart` cannot be carried
by a reload (pm2 drops non-aliased option keys, see the reference memory) and
stay read-only. Stored in a **separate Redis key** (`<ns>:autoscale:supervisor`)
so the tick loop never reads it — only a restart does. `reloadDeclaration`
always emits the **full managed set**, not just overridden fields, because pm2
keeps whatever the last roll pushed — a released field would otherwise never
revert. Rows carry the `PM2_*` env var name (not the pm2 entry name) as the
field label, with the entry name folded into the tooltip instead — jean's
explicit ask after the first pass used the entry names.

**Bug found while writing the blackbox coverage**: `PM2_MAX_MEMORY_RESTART` is a
pm2 *size string* (`'512M'`), typed `'string'` in TYPE_MAP, but `fromEnv` did a
bare `Number('512M')` → `NaN` → the field silently dropped from every
declaration. Consequence: set a memory ceiling from the panel, release it, and
the last-pushed value would stay forever instead of reverting to the
environment's. Fixed by parsing K/M/G suffixes (bare number = bytes, matching
what pm2 itself means by one).

**Blackbox scenario** `tests/db/app/autoscale-supervisor-options.test.ts` proves
the end-to-end claim that could not be verified any other way (it's pm2's own
internal behaviour under a flag, not something a unit test can falsify): a value
PATCHed through the panel reaches the **replacement worker's** `pm2_env` after a
real rolling restart against a live pm2 daemon, and releasing it puts the
environment's value back on the next restart. Registered in
`sequential-tests.ts` (owns a pm2 daemon), 90s hint. Needed two follow-up fixes
after its first CI run: (1) `AutoscaleConfigAnswer` gaining a `supervisor` field
broke both autoscale MCP tools' typed `outputSchema` — a `tsc`/vitest-typecheck
break invisible locally because the worktree's shared `node_modules` drowns real
errors in ~73 unrelated `@directus/types` resolution noise
([[project_directus_worktree_shared_node_modules]]); (2) a genuine test race —
arm 1 asserted on the pool before the autoscaler had finished booting and
subscribing, so the reload-ask went out over pub/sub (no buffer, no
redelivery) to a listener that wasn't there yet. Fixed by having the pool boot
one worker under the floor, so arm 1's assertion can only pass once the loop is
actually running.

**Codecov `codecov/patch` gap closed** (`5bc0bd2cd0`, 91.05%→≥95%, confirmed
green on `be1e0c0e52`). Root causes, not guesses, per file: `controllers/utils.ts`
62 lines behind `redisConfigAvailable()` never true in a unit run (mocked true);
`autoscale/index.ts` 26 lines — the loop itself had *no* test at all (new
`index.test.ts` drives `runAutoscaler` on a fake clock, `vi.advanceTimersByTimeAsync`,
one tick per step); `services/utils.ts` 13 lines; `override.ts`/`resolve-config.ts`
10 lines. **21 lines in Vue/bundled files were deliberately left alone** —
proven to be bundled-build line drift where the rejection path already had a
passing test at that sha (see [[reference_codecov_line_coverage_api]]'s "line
numbers from a bundled build drift" note) — no coverage-shaped filler added.

**Table unification + titlebar rework, ~4 more screenshot-driven rounds
(`cca4a8d001` → `5a50d4889b`), then PR opened.** Net result:
- Supervisor table rebuilt to the config table's exact shape (thead, one
  `.edit` cell per row with value+unit+source box, cancel/apply/reset); a
  `SupervisorRow.source: 'override' | 'pm2'` feeds the same `sourceLabel`.
  Read-only rows (`instances`/`execMode`/`waitReady`) render the same disabled
  box instead of dropping the shape. Config table's Field column switched to
  the `PM2_AUTOSCALE_*` variable name (new `AutoscaleField.variable`), matching
  what the supervisor table already showed.
- **`private-view.vue` gained a `sidebarWidth?: number` prop** (default 280,
  matching upstream) driving a `--sidebar-width` CSS custom property read by
  the three previously-hardcoded 280px sites (`#sidebar` inline-size,
  `.flex-container` inline-size, `.is-open` flex-basis). The 60px collapsed
  peek and the 960px/1260px overlay-vs-shrink breakpoints are untouched by
  design — below 1260px a wider drawer still overlays exactly as before; only
  a page that opts in gets a wider open state. See
  [[reference_directus_private_view_sidebar_width_prop]] for the mechanism,
  the shadowing trap it caused, and the test-harness slot gap it exposed.
- The panel moved into `processes.vue`'s `#sidebar` (a `sidebar-detail` at
  first 620px then 720px, per direct ask) so both tables get real width; the
  levers (pause/pin/restart/drill) teleport out to `#actions:prepend` in the
  titlebar via a new optional `actionsTarget: HTMLElement | null` prop on
  `autoscale-panel.vue` (`<Teleport :to :disabled>` — with no target the panel
  still renders them in place, so its own standalone tests are untouched).
- Titlebar cleanup: button labels became icons (⏸/▶ pause-resume, 📌/`keep_off`
  pin-unpin, ↻ restart) with the old labels moved to tooltips; the drill's
  `60s`/`80%` inputs plus start/stop button now sit inside one bordered
  `.knobs` group instead of loose controls; the restart confirm became a
  `v-dialog` (was two in-place buttons) — the "what a restart costs" text
  that used to live in a tooltip on a button whose tooltip a disabled state
  makes unreachable moved into the dialog body instead.
- **Chart tooltip fix**: ApexCharts' `updateOptions()` rebuilds the tooltip on
  every tick, so hovering during a live refresh interval kept losing the
  tooltip mid-read. See [[reference_directus_apexcharts_tooltip_quirks]] for
  the hold-while-hovered mechanism and the marker-dot alignment fix bundled
  with it.
- Redis keys renamed onto one radical: `<ns>:autoscale:config` →
  `<ns>:config:pm2`, `<ns>:autoscale:supervisor` → `<ns>:config:pm2:supervisor`;
  the panel now prints "Stored in Redis under <the key>" as a visible label
  (there was none before). **Renamed again on the processes-module branch** —
  see below.
- Config defaults changed per direct ask: `PM2_AUTOSCALE_MIN_WORKERS` default
  confirmed already 1 (what jean saw as 2 was the *preview workflow's own*
  override, since dropped so the preview runs the shipped default);
  `PM2_AUTOSCALE_SCALE_CPU_THRESHOLD` default 60→70.
- **`wait_ready` preview-only false-alarm**: `ecosystem.config.cjs` does
  declare `wait_ready: true` + `listen_timeout: 15000` and
  `api/src/server.ts:213` does send the ready signal — Scalabus supports it
  correctly. The preview workflow starts pm2 straight from the CLI
  (`pm2 start directus/cli.js --instances N`), bypassing the ecosystem file
  entirely, so neither flag was ever set there and the panel reported the
  true absence. Fixed by adding `--wait-ready --listen-timeout 15000` to that
  CLI start so the preview matches what a real deployment runs. **Lesson: a
  panel reporting an unexpected value from `pm2_env` may be telling the truth
  about the preview's own bootstrap, not about the shipped defaults —
  check how the environment actually started pm2 before treating it as a
  product bug.**
- "The pool finished restarting" became a one-shot notification on the
  transition (`describeReload` returns null once settled) instead of
  lingering inline text; a *failed* restart still shows inline since a
  failure isn't news that expires.
- Pool summary + last-decision line moved out of the panel into the page body
  itself, under the `3 processes / 3 responding / 1 replicas` totals line, via
  the same teleport-with-target pattern as the levers (`summaryTarget`).
  The "Deployment against its limits" chart title was dropped as noise.
- Verification pattern held throughout: mutation-test every new claim before
  each push (couldn't find one instance across ~6 rounds where this was
  skipped), rerun the exact edited file alone to separate a real regression
  from the known ~5s vitest-tree-timeout flake, one full suite run after the
  last edit before pushing.
- **PR opened**: https://github.com/jclaveau/directus/pull/467, base
  `v11.10.1-hhh-dev`. Jean's own words on reaching this point: "ok this seem
  usable, pr link" — read as sign-off on the UI shape, not as "done"; the next
  ask in the same delta was "everything bb tested or unit if not possible?"
  (unresolved at handoff — a coverage audit, not more feature work).

**Still open:** registering `PM2_WAIT_READY` as a writable supervisor option
(no env var exists to back it — `wait_ready` is hardcoded `true` in
`ecosystem.config.cjs`, offered twice, still no answer); an MCP tool for the
supervisor write (MCP only reports it); no blackbox scenario for "release
under falling load" or the other rollback levers, and no unit regression test
for the `unhandledRejection` guard (all three since DONE on #456,
[[project_directus_pr456_open_items]]); the 4 blackbox files touched by the key rename
were never re-run under `Run Blackbox` (offered, no answer yet, PR merged
gates were unit/lint/style only at handoff).

## The MCP reaches every lever the panel does (2026-09-10)

The audit that prompted this: MCP **data** was already complete (every
`AutoscaleNodeState` field via `read_autoscale_config.running[]`, and per-node
`autoscale` on `list_processes`), but of 22 knobs only the 13 `AutoscaleConfig`
fields were writable. Missing were the supervisor options (read-only), the
rolling restart, and the whole drill.

Four tools added, each calling the service the REST route already calls:
`write_supervisor_config`, `restart_autoscale_pool`, `read_autoscale_drill`,
`run_autoscale_drill` (`stop: true` folds the DELETE, mirroring
`write_autoscale_config`'s `clear`).

Settled decisions, do not re-litigate:

- **The drill is its own `SYSTEM_MCP_TOOLS` group, `autoscale_drill`** — it is
  the only tool that spends the deployment it describes, so an operator can hand
  over the configuration levers without it. Gated on `autoscaleDrillEnabled() &&
  redisConfigAvailable()`, the same two gates its REST routes carry.
- **Annotations classify by what they disturb, not by whether they write.**
  `DISTURBS_POOL` (destructive, non-idempotent) is the restart and the drill;
  storing options stays `CHANGES_CONFIG`. `tools.test.ts`'s old blanket
  `destructiveHint === false` assertion was replaced by two tests pinning the
  split.
- Bounds and refusals stay in `UtilsService`; the tools hand arguments through
  unread, so `seconds: 600` is refused rather than shortened on both surfaces.

New bb suite `autoscale-mcp-levers.test.ts` (sequential, 120s hint) — a real
pool + a real autoscaler + a Directus serving the MCP on one Redis, proving an
agent's `listenTimeout` reaches both workers through the restart it also asked
for, and that storing alone changes nothing. Refusal arms went into
`autoscale-config-validation.test.ts`, drill arms into `autoscale-drill.test.ts`.

MCP answer shapes for bb: success is `body.result.structuredContent`, a refusal
is `body.error.code === -32602` with the service's own message.

## Review round after the MCP levers (2026-09-10)

Eight commits on `v11.10.1-feat/autoscale-config`, `5efb66e17b`→`93f4c4ef95`,
each with a regression test that goes red without it (all mutation-verified):

- **A drill's stop only ended the drill on the worker that served it.** The
  1s rebroadcast that keeps a drill announced is module state of the *starting*
  worker; a stop landing anywhere else cleared that worker's interval, not the
  starter's, so the announcement went out again and every worker resumed to the
  original deadline while the panel reported it over. The announcement is what
  every worker already listens to, so `announced()` now stops its own
  rebroadcast on a deadline already past.
- **`Object.hasOwn` before a field lookup** in both patch parsers — `constructor`
  reached the type check with a function as the expected type. Both writes were
  already refused; only the message was wrong.
- **A memory ceiling under a megabyte is now `null`, not `0`.** pm2 reads a bare
  `PM2_MAX_MEMORY_RESTART` as *bytes*; `400` boots as 400 bytes (pm2 ignores it)
  but `megabytesOf` rounded it to 0 MB and the next roll pushed a zero ceiling
  onto every replacement worker.
- **The panel keeps what a refused write did not take** — the two tables also got
  separate draft maps (`drafts` / `supervisorDrafts`), since a field named in both
  was one draft answering for two routes.
- **A note box above the tables**, carried into every change made from the page
  (levers and supervisor options included) and sent as `note: null` when empty, so
  a reason never dates the change after the one it was typed for.
- **Three time-reads fixed**: the restart toast fired on the panel's first report
  (it mounts before the pool reports, so any finished restart announced itself on
  page open); `stamp.days` read `Date.now()` inside a computed Vue cannot
  invalidate, now the panel's own ticking clock; the drill is re-read on every
  report, since any admin can start or stop one elsewhere.
- **The eight autoscale operations are published in the OpenAPI** under an
  `Autoscaling` tag carrying `x-authentication: admin`, plus
  `x-enabled-by: PM2_AUTOSCALE_DRILL_ENABLED` on the drill path
  ([[project_directus_oas_publishing]]). Blackbox reads `/server/specs/oas` as
  admin, as an app user and as nobody, anchored on `/auth/login` so an absent tag
  is the tag's absence and not an empty answer.

Behaviour change to know: the three pacing fields (`minSecondsToScaleUp`,
`minSecondsToScaleDown`, `warmupSeconds`) now clamp to 86400 rather than
`Number.MAX_SAFE_INTEGER`, and the panel offers the same day as a `max`.

## The `shared` radical (2026-09-10, commit 930792bac9)

The Redis-stored layer is the **shared config**, never an "override". `override`
named the operation (winning over the env chain) instead of the thing, and a bare
`config` was unavailable: `AutoscaleConfig` is the *resolved whole*, so the stored
*partial* needed its own word. jean picked `shared` / `sharedConfig` from four
ranked candidates ([[feedback_name_vocabulary_one_radical]]).

The whole vocabulary, one commit: `SharedAutoscaleConfig`,
`SharedAutoscaleConfigAnswer`, `SharedSupervisorConfig`, `readSharedConfig` /
`writeSharedConfig`, `readSharedSupervisorConfig` / `writeSharedSupervisorConfig`,
`parseSharedConfigPatch` / `applySharedConfigPatch`, `AutoscaleNodeState.withoutShared`,
files `lib/shared-config.ts` + `lib/supervisor-shared-config.ts`, and the OAS
components `autoscale-shared-config{,-answer}.yaml`.

**The radical is never shortened.** jean, on the first attempt: _"plz respect the
sharedConfig / SHARED_CONFIG namespace, do not shorten it as \"shared\" or
\"config\" or \"SHARED_\""_. So `sharedConfig` in code and on the wire,
`SHARED_CONFIG` in constants, `shared-config` in file names — and a name that
would split the pair reorders instead: `AutoscaleSharedConfig`,
`SupervisorSharedConfig`, `readSupervisorSharedConfig`, `supervisorSharedConfigKey`,
`withoutSharedConfig`, `configWithSharedConfig`, `sharedConfigUnreadable`,
`SHARED_CONFIG_READ_TIMEOUT_MS`.

Two values changed on the wire, not just in the source:
- `AutoscaleValueSource` is `'default' | 'env' | 'sharedConfig'` (was `'override'`).
- The panel labels that source `shared config` where it read `config`
  (`t('autoscale_source_shared_config', 'shared config')`) — prose, so the two
  words are spelled out.

Redis keys did not move during the `sharedConfig` rename. They moved once more
on the stacked `v11.10.1-feat/processes-module` branch, to match the module:

- `<CACHE_NAMESPACE>:config:processes:autoscale` — the autoscaler's own config
  (`autoscaleConfigKey()` in `processes/autoscale/lib/resolve-config.ts`)
- `<CACHE_NAMESPACE>:config:processes:supervisor` — the pm2 declaration an
  operator may change (`supervisorSharedConfigKey()`, same file)

`pm2` left the key because it named the vendor, not the document — and the
first key never held pm2's config at all, it holds the autoscaler's. Two leaves
under one `processes` prefix rather than a flat `:config:processes`, because
there are two documents. Free to do only while #467 is unmerged: prod runs the
pinned `-dist` off the trunk, so no production Redis ever held the `:config:pm2`
form. After #467 merges the same change becomes a data migration (read-both, or
accept a silent fall back to env). The PR body's older claim of
`<namespace>:autoscale:config` was stale and is corrected.

A generic `overrides: Partial<T>` test-fixture parameter is *not* this vocabulary —
those stay, repo-wide idiom.
