---
name: project_directus_shared_settings_source_of_truth
description: Postgres is the source of truth for settings shared across instances; Redis is transport + cache, never the only copy — the five-layer model and why the autoscale config violates it (issue #473)
metadata:
  author: Jean Claveau
  type: project
---

Settled 2026-09-10. **Issue #473.** Jean asked whether Redis is a reliable
source of truth for settings shared across instances, and what the right model
is. Answer: no, and the fork's own code already argues it.

## The evidence Redis is a cache here, not a record

`processes/autoscale/lib/shared-config.ts:177` stores the whole autoscale config
as `redis.set(key, json)` — **no TTL, no second copy**. `resolve-config.ts:322`
reads it back and treats a missing key as "reset to env"
(`if (!stored) return settle(fromEnv, {})`), **silently**: `sharedConfigUnreadable`
fires only on a read *error*, never on absence. A flush, an eviction-policy
change or an empty volume reverts the pool to `PM2_AUTOSCALE_*` with no log line.

Everything around it is written for Redis being absent (`redisConfigAvailable()`,
last-good hold, `autoscale-redis-outage.test.ts`, #366's five outage paths) — a
store you design outage handling for is a cache. And the four `NOTE_FIELDS`
(`setBy`/`setAt`/`setFrom`/`note`, `shared-config.ts:34`) are hand-rolled audit
that exists **only because Redis has none**; `directus_revisions` already does it.

Not verified: this deployment's Redis persistence config (`railway` unlinked from
the checkout). Doesn't change the conclusion — persisted Redis still has no
migrations, no owned backups, no revisions.

## The model (five layers, one job each)

| layer | who |
|---|---|
| durable truth | a `directus_settings` column in Postgres |
| propagation | a bus channel carrying a **signal**, not a value |
| local read | a module-level mirror |
| self-heal | a slow floor re-read (~30s) |
| fallback | env, `null` = "inherit env" (the `cache_ttl` semantic) |

Redis keeps **transport** (pub/sub) and **cache** — never the only copy.
Redis-as-truth is defensible only for state that *should* die with the cluster
("is a drill running right now"), never for tuning.

A signal beats a value on the bus: a missed message costs staleness, never a
wrong value.

## The four live-settings mechanisms in the tree — three shapes

| what | durable store | propagation |
|---|---|---|
| cache TTL (`cache-config.ts`) | `directus_settings.cache_ttl` — **PG** | bus carries the **value**; boot re-seeds |
| cache-stats on/off (`cache-events.ts`) | Redis key | bus is a **signal**; subscriber re-reads — the model's shape |
| autoscale **supervisor** key | Redis key | bus signal, read inside the restart (`reload.ts:171-174`) |
| autoscale **config** key | Redis key | **1 Hz poll on the tick's critical path** |

The last two are ten lines apart in the same module: the autoscaler is already
internally inconsistent about this.

## Applied to autoscale (issue #473's phases)

1. One nullable **JSON column** (`directus_settings.autoscale_config`), not 17
   scalars — the payload is already a validated document (`FIELD_TYPES`,
   `parseSharedConfigPatch`). Normalise with `parseJSON`
   ([[project_directus_get_schema_raw_knex_json]]). Note fields retire into
   `directus_revisions`. Cost: `processes/autoscale/` imports **no database at
   all** today (verified) — give it the lazy best-effort
   `import('./database/index.js')` that `cache-config.ts:44` already uses to keep
   the dialect graph off the hot path, not a bus query (that would make config
   depend on a live worker). Boot-order hazard: the planner's API container never
   migrates ([[project_directus_planner_deploy_shape]]) so the column may be
   absent — best-effort read + env fallback, like `initCacheConfig`.
   3 blackbox files write the key directly and would move to the route.
2. **The poll retires as a consequence, it is not a separate project.** Once the
   value is mirrored, `SHARED_CONFIG_READ_TIMEOUT_MS`, the `DISCONNECTED` set and
   the `read.catch(() => {})` guard (`resolve-config.ts:188-232`) have nothing
   left to protect.
3. A shared `liveValue` helper only **after** two consumers follow the model —
   factoring first would freeze one of the three wrong shapes.

**Timing: cheapest BEFORE the first deploy that ships #456** (which since
2026-09-10 carries #467 and #472 too). Nothing has stored
a config in production yet, so PG-from-the-start needs no data migration; after,
it needs read-old-key → write-PG → delete. Window closes at the next planner
deploy PR bundling #467. The precedent costs one migration + one `settings.yaml`
entry (`20260724A-add-settings-cache-ttl.ts`).

## Testing this model (added to #473 2026-09-10)

**Not unit-only — the rig exists.**
`tests/blackbox/tests/db/app/cache-config-broadcast.test.ts` is the model under
test already: two `cli start` instances differing only by `CACHE_NAMESPACE` (same
DB + same Redis → shared settings row and bus), every assertion on the node that
did NOT write, polled via `awaitEffectiveTtl` because the bus is async. Covers
write-through-`SettingsService`, write-past-it (`/settings-import-write`, a
config-sync import through a plain ItemsService) and clear-to-null. Copy it.

**The gap a PG-backed autoscale config hits:** `tests/blackbox/tests/db/app/
autoscale/rig.ts:95-105` spawns `directus autoscale` with `...process.env` +
PM2 overrides and **no `DB_*`** — the vendor DB env lives in
`config.envs[vendor]`, which only `cli start` instances get. Harmless while the
autoscaler speaks only Redis; the move requires passing the vendor env and
rewriting the 3 key-writing tests (`autoscale-config-source`, `-legacy`,
`-redis-outage`) to seed a settings row. Most test churn in the issue.

Unit-only arms: column absent (pre-migration boot), PG unreachable → env
fallback, dialect-native JSON meta, bounds/corrections. And bb-only code credits
~20% on the unflagged 95% patch gate
([[project_directus_codecov_aggregate_patch_gate]]), so the module's pure half
(read/parse/merge/fallback) must be unit-callable **without a knex** regardless
of bb reach.

Rig caveat: the bus namespace is a fixed `directus:bus`, unscopable — multi-vendor
runs cross-talk; CI's one-vendor-per-job is what hides it.

## Does the write get a `directus_revisions` row? (checked 2026-09-10, informs step 2)

Yes, structurally — `directus_settings` gets no `accountability` override in
`collections.yaml` (the file default is `'all'`), and `items.ts:988/1007`
writes activity when accountability is non-null, a revision when it is
exactly `'all'`. In-tree precedent: `cache-config.ts`'s own comment says a
production `cache_ttl` reset "stayed invisible until `directus_revisions` was
read by hand (#342)" — the revision was there. Not confirmed on real data:
dev's `directus_revisions` has zero `directus_settings` rows (never written
through the app there); prod is CTO-gated, unqueried.

Three catches this puts on the write path, not just the note-fields
question:
1. **Only a write through `SettingsService` gets one** — a raw `knex.update`
   produces nothing, so "revisions instead of note fields" is really a vote
   for the write path (matches step 2's `SettingsService.upsertSingleton`
   choice).
2. **Only with an accountability set.** An admin PATCH has one; a
   config-sync import or a seed script may not — the same gap
   `cache-config.ts` already had to announce from the `settings.update`
   *action* hook rather than trust the writer.
3. **Revisions have no column for `setFrom`** (page vs MCP vs API). They
   record the delta and the user, not which surface wrote it — so retiring
   the four hand-rolled `NOTE_FIELDS` into revisions loses that one field
   unless something else carries it.

## Rename `sharedConfig` → `sharedSettings`, locked 2026-09-10

jean, mid-execution of #473: *"Before going further shouldn't we rename it
shared_settings everywhere to align with the existing design?"* — measured
first (283 occurrences / 32 files, including the published OAS + MCP tool
schemas), then five decisions locked before cutting anything:

- **Layer name**: `sharedSettings` over `fleetSettings` (new radical, costs
  more) or keeping `sharedConfig` (keeps two collisions below). Once the
  store is `directus_settings`, "config" collides with env/file config
  (`envConfig()`) *and* with `AutoscaleConfig` itself (the resolved value,
  not the layer) — `sharedConfig` reads like a document, `sharedSettings`
  reads like a layer, matching `AutoscaleValueSource`'s other members
  (`'default' | 'env'` are layers too).
- **Timing**: now, inside this PR. `sharedConfig` is a frozen external
  contract (OAS field name, MCP tool schema) only once it ships — #456 is
  still open, nothing deployed but scalabus-dev's MCP wiring (a re-wire, not
  a break). Same window-closes-at-first-deploy argument as the PG migration
  itself.
- **Two Postgres columns, not one JSON blob** — mirrors the two Redis keys
  (`config`/`supervisor`), which #467 split deliberately ("its own key
  rather than a corner of the configuration's": one is read every tick, the
  other only during a rolling restart). Folding them into one
  `processes_settings` JSON would undo that split.
- Mechanical trap hit executing it: a plain find/replace broke grammar —
  "shared settings" is plural where "a shared config" was singular. 143
  prose sites needed agreement fixes by hand, not substitution. Style gate
  + full eslint + api (283/283) + app (152/152) all green after.
- Branch: new branch off #456's head (a stacked PR), per jean's answer.
  **Not committed at delta-write time** — the rename lands green locally but
  is still sitting in the worktree.

## Built 2026-09-10 — branch `v11.10.1-feat/shared-settings` (off #456's head)

Two commits, gates green (api 91 files/995 tests + `Type Errors: no errors`,
app 4/152, eslint 0, style gate clean). **Not pushed, no PR** — awaiting jean.

1. `dcefc875c6` — the `sharedConfig` → `sharedSettings` rename, 283 sites
   including the OAS component files and the MCP tool descriptions. Grammar
   trap: "shared config" is singular and "shared settings" is plural, so ~67
   prose lines needed rewriting rather than substituting.
2. `7a7d51eb8f` — the move itself, 31 files.

**Shapes worth remembering:**
- Two columns, `directus_settings.autoscale_settings` +
  `.supervisor_settings`, `table.json(...).nullable()`, migration
  `20260910A-add-processes-shared-settings.ts` (a plain column add needs no
  `.test.ts` — `cache_ttl`'s has none). Plus `settings.yaml` entries with
  `special: [cast-json], hidden: true` and two `packages/types` fields.
- `api/src/processes/lib/shared-settings.ts` is the generic module:
  `SHARED_SETTINGS_COLUMNS`, `readSharedSettings(column)`,
  `writeSharedSettings(column, settings, options)` through
  `SettingsService.upsertSingleton`, `onSharedSettingsChanged(column, reread)`,
  and `initSharedSettings()` wired in `app.ts` right after `initCacheConfig()`.
  One channel `sharedSettingsChanged` carrying `{ column }`; subscribers filter.
- `resolveConfig()` is now **synchronous** — that is phase 2's whole payoff.
  The mirror lives in `resolve-config.ts` with a 30s `MIRROR_FLOOR_MS`;
  `initSharedSettingsMirror()` is awaited at boot in `autoscale/index.ts`.
- The `redisConfigAvailable()` route gate in `controllers/utils.ts` is
  **deliberately kept**: de-indenting ~97 lines would re-charge every one of
  them to the 95% codecov patch gate, and widening the route surface is a
  contract change of its own.

**Blackbox, resolved differently than the issue guessed.** The rig does NOT
need a private database: every autoscale suite already sits in
`setup/sequential-tests.ts`'s `after` list, so they run one at a time and can
share the vendor's `directus_settings` singleton safely. `rig.ts` grew
`databaseEnv(vendor)` (the spawned autoscaler gets no `DB_*` from
`process.env`), `storeSharedSettings(vendor, column, settings, announce = true)`
writing through knex, and `closeSharedSettings()`. The announcement is
published straight onto `directus:bus:sharedSettingsChanged` — same trick the
suite already used for `directus:bus:autoscaleReload`, and the bus takes plain
JSON because compression only starts at 1000 bytes.

`announce = false` is what buys the two arms that could not exist before: a
change reaching a node the bus never told (healed by the floor), and a deploy
coming up with Redis unreachable still running every stored value.
`autoscale-redis-outage.test.ts` inverted meaning as a result — it now proves
Redis is only transport, including a write landing on the pool *while the
connection is cut*.

## PR #475 opened, blackbox found two real bugs (2026-09-10)

Both bb-gap-closing and audit for "fully bb tested?" landed amended into
`83f71f18d9` first (new arms: revision/audit-trail assertion, an
`ItemsService`-only write still carrying the announce, generalized
`settings-import-write` extension; plus 7 stale fixture strings swept from
`scalabus:config:processes:*` to `directus_settings.{autoscale,supervisor}_settings`).
Then pushed, **PR [#475](https://github.com/jclaveau/directus/pull/475)**
opened (base `v11.10.1-feat/autoscaler`, #456's head — the stacked-PR plan).

**CI unit gate caught what local didn't:** the vitest typecheck ambient
`Errors N` line is hidden on a per-file local run
([[project_directus_vitest_typecheck_gate]]) — CI's full run failed on an
`ActionHandler` cast in `shared-settings.test.ts` with too few params; fixed
by dropping the re-type and destructuring the real handler instead of
casting it.

**Blackbox then found two genuine defects — not test noise, both shipped by
this PR:**

- **Cause A — `process.exit(1)`, not `throw`, on missing DB env.**
  `readSharedSettings` → `getDatabase()` → `validateEnv`; a `try/catch`
  around it cannot catch an exit. Any rig spawning the autoscaler without
  `DB_*` was killed on its first tick — `autoscale-ramp` (all 6 arms),
  `-release`, `-supervisor-restart`, `-legacy`'s first arm. Fix: `rig.ts`'s
  `startAutoscaler` now injects the vendor's `DB_*` by default (the process
  always has one in a real deployment); suites naming their own vendor still
  override.
- **Cause B — an unhandled bus-promise rejection kills the process.**
  `Bus.subscribe()`/`.publish()` return promises; both were fire-and-forget
  in `shared-settings.ts`. Against an unreachable Redis the rejection was
  unhandled → Node exits — which killed exactly the arm whose entire claim
  is that a Redis outage must NOT take the pool with it
  (`autoscale-redis-outage > uses the stored settings when Redis has never
  answered`). The PR was shipping the exact failure #366
  ([[project_directus_redis_outage_kills_process]]) exists to prevent — same
  bug shape, new call sites. Fix: both bus calls now `.catch()` + warn; a
  node that can't subscribe stays current on its own 30s mirror floor.
- Isolation fix alongside: `autoscale-ramp`/`-release`/`-supervisor-restart`
  now clear `autoscale_settings` in `beforeAll` — they read the shared
  singleton and race `autoscale-config-validation` in the parallel middle,
  which writes that same row.
- Two new unit arms pin the outage handling, mutation-checked: remove the
  `.catch`es → both fail; restore → all 408 pass
  ([[feedback_mutation_test_your_own_tests]]).
- Amended into `4be0d33f5b`, force-pushed, PR body updated with the `DB_*`
  requirement as a stated risk. Re-run (blackbox + unit) was queued on the
  new head; **outcome not yet observed in this session** — check PR #475's
  checks before trusting the branch green.

Related: [[project_directus_pr467_autoscale_config_surface]],
[[project_directus_processes_autoscale_consolidation]],
[[project_directus_cache_failure_semantics]],
[[project_directus_redis_outage_kills_process]],
[[project_directus_vitest_typecheck_gate]].

## PR #475 — fully green (2026-09-10), root cause was a third bug, not the two above

Round 3 (`1bc8c59646`, folding in the api mock-typing fix + app test timeout +
`reportOf(rig)` instrumentation) still failed blackbox shard 7 on
`autoscale-redis-outage.test.ts > uses the stored settings when Redis has
never answered`. `reportOf` (added specifically to answer this) named it in
one run: `autoscaler gone (code 1, signal null)` after a single
`[redis] ECONNREFUSED` WARN line — a process death, not a wrong-layer read.
Root cause, the wrong first fix, and the real fix are their own memory:
[[project_directus_entry_guard_unhandled_rejection]]. Round 4 (`67001aa5bc`)
shipped the wrong fix and jean's *"root cause bb regression tested?"*
question is what surfaced that it was wrong; round 5 (`9dd53be958`) shipped
the real one and closed shard 7 for good.

**Final state:** PR #475 fully green — 81 success checks, 1 skipped (Create
Release), zero failures. Head `9dd53be958`, base `v11.10.1-feat/autoscaler`
(stacked, merges after #456). Not yet merged as of this session.

**Post-green "fully bb tested?" audit (2026-09-10) found 3 real gaps,
none blocking, one squarely on this PR's own change:**

1. **`DELETE /utils/autoscale` is never asserted over REST.** It appears in
   bb only inside `afterAll` cleanup with status/body ignored; every bb clear
   goes through a direct `storeSharedSettings(..., null)` knex write instead.
   This route is *the one behavioural line #475 changed in the controller*
   (`{ data: { sharedConfig: null } }` → `sharedSettings`) — unit-covered
   (`controllers/utils.test.ts:168`) but not proven over the wire.
2. **`PATCH /utils/autoscale/supervisor` never called over REST** — only its
   OAS path string is asserted. MCP equivalent (`write_supervisor_config`) is
   bb-covered, service layer unit-covered; the HTTP call site specifically is
   the gap.
3. **`POST /utils/autoscale/reload` never called over REST** — bb triggers
   reloads by publishing on `RELOAD_CHANNEL` directly. Inherited from #456,
   not new here.

Jean's reply: **"bb test them all plz"** — **DONE**, all three land inside
`autoscale-config-validation.test.ts` over REST: `DELETE /utils/autoscale`
asserts 200 + `{sharedSettings: null}` + a read-back, `PATCH
/utils/autoscale/supervisor`, and `POST /utils/autoscale/reload` asserting
the 400 a pool nothing reported earns.

## Validation was at the wrong layer, and two boolean layers coerced (2026-09-11)

Three more commits on the same PR, each CI-green:

- `dde4efa8e1` — the checks lived only in `UtilsService`, so the route was
  guarded and the column was not. The columns are declared fields of the
  settings singleton, so `PATCH /settings` reaches them and stored a floor
  above its ceiling. `processes/lib/settings-guard.ts` runs
  `parseSharedSettingsPatch` + `assertUsableConfig` + `parseSupervisorPatch`
  on the `settings.create`/`settings.update` **filter** — the filter because
  a check runs before the write, the emitter because `SettingsService` is
  only one of the writers, and both events because a virgin singleton's
  first write is a create.
- `4c6d86ece5` — `initSharedSettings` had that same create gap for the
  *announcement*: a deployment with no settings row announced nothing on the
  first write to a column.
- `b0d649529b` / `61a93591b2` — the boolean coercion, at both layers. In
  `withSharedSettings` the boolean arm read anything that was not `true` as
  `false` while every arm beside it refused; a stored `"oui"` stopped the
  pool and the panel named the shared settings as what asked for it. All
  four arms now collect what they refused into `Layered.refused` and
  `resolveConfig` emits one throttled warning. **Refused, never thrown** —
  the merge runs on the scaling tick against an already-durable value, so a
  throw would end the pool every tick until somebody edited the table;
  refusal belongs on the write. One layer up, `toBoolean` reads
  `PM2_AUTOSCALE_ENABLED=TRUE` as `false`, so `validateBooleanEnv` (beside
  `validateEnv`, same `process.exit(1)` contract) refuses it at boot off
  `process.env` — before the cast, where a typo is still distinguishable
  from a deliberate `false`. Scoped to the two `PM2_AUTOSCALE_*` booleans;
  tightening `toBoolean` itself is breaking and wants its own PR.

**Merge state 2026-09-11:** #475 `mergeable_state: clean`, blackbox +
check.yml + Style + CodeQL + CLA all green on `61a93591b2`. Base is still
`v11.10.1-feat/autoscaler` and **#456 is still open**, so #475 merges into
the stack, not into `hhh-dev`. Unverified caveat: the boot check reads
Railway variables too, and only the planner's `.env` files were checked
(`true`/`false`, all fine) — a Railway variable holding `True`/`yes`/`on`
would refuse the boot on the deploy that ships this.

## Issue #477 filed — the wide `toBoolean` fix, deliberately out of scope

While scoping the `validateBooleanEnv` fix above, measured the blast radius
of tightening `toBoolean` itself repo-wide instead of just the two
`PM2_AUTOSCALE_*` keys: **41 keys typed `'boolean'`** in `type-map.ts` and
**42 non-test `toBoolean(env[...])` call sites** in `api/src` — bigger than
first estimated.

**Two different failure paths for the same symptom**, worth remembering
before touching either:
- A **typed** key (`'boolean'` in the type-map) goes through `cast()` →
  `toBoolean` → silently `false` for anything not
  `true`/`'true'`/`1`/`'1'`.
- An **untyped** key goes through `guessType`, which returns `'boolean'`
  only for the literal strings `true`/`false`
  (`packages/env/src/lib/guess-type.ts:4`) — so `TRUE` isn't even guessed
  as a boolean, it stays a string all the way to the `toBoolean(env[...])`
  call site and is read as `false` there instead.

Filed as **[issue #477](https://github.com/jclaveau/directus/issues/477)**,
framed as a choice: refuse **at the cast** (`packages/env/src/lib/cast.ts`
— closes both paths, but reaches every `@directus/env` consumer including
the CLI and extensions SDK) vs refuse **at boot** (one `validateBooleanEnv`
call derived from the type-map — contained to the API, misses the untyped
call sites). Left the call to whoever picks it up; noted it wants measuring
first — which of the 41 keys are actually set, and with what spelling, in
both the planner `.env` files *and* the Railway variables (which beat the
files, [[reference_planner_readenv_precedence]]).
