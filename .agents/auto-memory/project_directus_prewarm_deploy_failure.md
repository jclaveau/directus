---
name: project_directus_prewarm_deploy_failure
description: PM2_AUTOSCALE_PREWARM=15 failed every deploy of a prod consumer — the 15s supervisor bound, the terminal prewarmed latch, and the health target nothing reconciles (fork #490)
metadata:
  author: Jean Claveau
  type: project
---

**2026-09-15, a prod consumer.** The first deploy that actually ran the fork's
autoscaler in prod failed twice with `PM2_AUTOSCALE_PREWARM=15`.
Filed as fork **#490**. Prod only came up once `PM2_AUTOSCALE_PREWARM=0` was set
as a service variable by hand.

**It is size-dependent, which is why nothing caught it.** The same commit
deployed clean to dev with `PREWARM=3` — `prewarming api from 1 to 3 workers`,
target reached, health 200, then released 3→2→1. Prewarm is transient by design;
what matters is that the pool *touches* the target once so the latch fires.

The chain, each link independently fixable:

1. `SUPERVISOR_TIMEOUT_MS = 15_000` (`supervisor/lib/client.ts:33`) is flat and
   covers `scale` (`:266`). Starting 14 Directus workers at once does not answer
   in 15s. `reload` already takes a `timeoutMs` override (`:317`); `scale` does
   not. The timeout does not cancel pm2, so the forks keep arriving — the pool
   reached 8-9 with nothing owning that.
2. `prewarmed = true` is set **before** the await
   (`processes/autoscale/index.ts:333`), so the per-tick catch swallows the throw
   and no later tick retries. Terminal.
3. `targetPoolSize()` (`autoscale/index.ts:104`) is a pure function of config, so
   it stays 15 whatever the pool did. `record()` latches only on
   `failedWorkers === 0 && onlineWorkers >= targetWorkers`
   (`lib/pool-health.ts:87`) → `poolHasComeUp()` false → `server.ts:212` answers
   503 for the deployment's life → Railway's 300s healthcheck default → FAILED.
   **A prewarm value can make a deployment unable to start at all.**
4. `decide()` then released the still-filling pool 9→8→7→6→5→4, one per 60s, each
   release re-arming `lastScaleDownAt`.

The consumer's Railway config sets no `healthcheckTimeout`, so the window is
Railway's 300s default.

Beside it, and eating 2.8 min of that same window:
[[project_directus_build_identity_cache_flush]]'s boot flush measured
**167.8s** on prod's ~270k-key Redis, awaited before `listen()`, with a
`BUILD_IDENTITY_FLUSH_LOCK` TTL of 30000ms — 5x shorter than the work it guards.
That figure also answers fork #468. The flush is **not** per-deploy: rolldown
folds `resolveCoreBuildId()` to a literal in the shipped dist, so
`RAILWAY_GIT_COMMIT_SHA` and `version` are dead code in the artifact and the core
half moves only when the dist pin moves; a redeploy of the same commit did not
flush.

See [[project_directus_pm2_autoscale_ramp_measured]] (and the consumer repo's
memories) for the surrounding numbers.

**Fixed in PR #491** (`v11.10.1-fix/prewarm-deploy-failure`, CI + blackbox
green): the prewarm walks the pool up `PREWARM_STEP_WORKERS = 2` a tick and
latches on the pool having **reached** the size rather than on a step having
been sent; the flush lock is refreshed for as long as the flush runs and the
boot waits only `CACHE_FLUSH_TIMEOUT` for it. Why a big scale cannot be answered
at all is [[reference_directus_pm2_scale_cost]]. Blackbox arm:
`tests/db/app/autoscale-prewarm-health.test.ts`, third arm, eight workers three
seconds apart.

**Deep review of #491 (`805a2a4979`→`2547d17d47`, CI green both times, mutation-
checked): no correctness defect**, but `PREWARM_STEP_WORKERS = 2` sits ON the
15s bound under incident boot pace (~8.5s/worker under the flush → 2 boots ≈
17s) — degrades gracefully (one failed-tick log + a supervisor reconnect per
tick, progress preserved via `online+pending+2`), not cleanly.

**2026-09-16, jean: "go" — KISS redesign decided, not yet landed.** Root cause
isn't the step size, it's applying the dead-daemon `SUPERVISOR_TIMEOUT_MS`
bound to a call that is slow *by nature*. pm2 already serializes every boot
regardless of the step requested ([[reference_directus_pm2_scale_cost]]), so
stepping doesn't shorten wall time — it only shortens how long one supervisor
call stays open before `answeredInTime` reconnects mid-chain and kills the
un-sent rest. The PR's own "spreads the boot CPU a batch would spend at once"
rationale is wrong for the same reason: pm2 never batches, so there's no spike
to spread.

New design: every tick the pool is short of target, fire a bare, **untimed**
`askScale(app, n)` (small addition to `supervisor/lib/client.ts`) for the
**whole** target — not awaited into the tick, `.catch` → log only, never
routed through `answeredInTime`. Dead-daemon detection stays where it already
lives: `readPool`'s own 15s-bounded call on the *next* tick. Re-asking
`scale(target)` while pm2 is still mid-launch to that size hits pm2's "already
at that size" response, already handled as a no-op — so no ratchet, no
double-launch. This removes `PREWARM_STEP_WORKERS` entirely, its rationale
comment, the stepped log line (back to `prewarming api from 1 to 15 workers`),
one unit test, and the bb arm's step-count assertion.

**Landed 2026-09-16, `6edecfcda6` on #491.** `requestScale` (raw, unbounded)
+ `scaleApp` (wraps it in `answeredInTime`, for callers that still want the
bound) in `supervisor/lib/client.ts`; `prewarmAsked` tracks the one in-flight
ask so a short tick re-asks only after it settles (see
[[reference_directus_pm2_scale_cost]] for why re-asking mid-chain overshoots
rather than no-ops). Unit tests rewritten (4 prewarm cases + one new
`client.test.ts` case), 5 mutants killed. bb arm 3 dropped the step-count
assertion for one `prewaming api from 1 to 8 workers` line; reran at 109.6s
(was 113.2s with steps). CI on `6edecfcda6`: all green, 8/8 bb shards.
Ready to merge, waiting on jean's "merge it".

**Not load-tested** (jean asked): unit proves the ask-once/re-ask-after-settle/
latch logic against mocked pm2; bb arm 3 proves pool-reaches-target + health
flip + no-overshoot against real pm2 but a stub worker (no HTTP load, no real
Directus boot cost). Real Directus worker boot pace, prewarm=15 at
Railway-container size, health-flip timing under Railway's healthcheck window,
and prewarm racing live traffic are all uncovered.

Considered venues for closing that gap: a dispatched PR-preview run, a dev
Railway redeploy, or an extra arm on `pm2-autoscale-release.smoke.spec.ts` —
each needs a manual trigger or a redeploy. **Jean's call 2026-09-16: the CI
load test lives in THIS pr (#491)** — "it's here to prove the autoscaler has
the expected behavior hence the current pr changes". `bench.yml` only fires on
a trunk push, so it LANDED as a blackbox arm (runs on every PR):
`tests/blackbox/tests/db/app/autoscale-prewarm-load.test.ts` on commit
`752ea560c3`, green, **34-41 s on the runner** (shard hint 50_000). Real
Directus as the pm2 pool via the rig's new `startPool({ directusEnv })`
(cluster, `wait_ready`, `listen_timeout` 60 s, `kill_timeout` 25 s);
four request loops on `/server/ping` + `/users/me` from before the autoscaler
starts; the pool is read every 250 ms for the whole run and the sizes HELD
(≥1 s, first size kept by definition) are asserted as a curve
`1 2 3 4 5 6 3 2 1` (pm2 serial boot staircase, then #494's halving
`ceil((6-1)/2)=3`, then 2, then 1, steps ≥ cooldown−1 s apart), zero non-200,
one `prewarming` line; the curve is printed
(`[prewarm-load] … pool curve: 1@0s 2@1.5s 3@5.1s 4@9.4s 5@12.3s 6@15.6s
3@23.4s 2@29.4s 1@34.4s`). Trap: `PM2_AUTOSCALE_WARMUP_SECONDS` must cover
the 5-tick sample window (set 8) — with 2 s the first release decision still
averaged traffic-phase CPU (traffic stops when the 6th worker is LISTED, while
it boots) and released toward target 2 (`6→4→2→1`) on one run and 1 on another. Health deliberately NOT asserted
there: `useBus` namespace is hard-coded `'directus:bus'` (`api/src/bus/lib/use-bus.ts`),
so on the shared Redis 6108 another suite's autoscaler reading can lift this
pool's hold — the health arm carries that witness. Two CI-only traps cost a
push each: pm2's `script` must be the FILE — `node <repo>/dist/cli` works
because the bb dist is the deployed `directus/` wrapper package
(`pnpm --filter directus deploy … dist`) whose bin is `<repo>/dist/cli.js`,
`node` adds the extension, pm2's `fs.existsSync`+`which` do not → use
`${paths.cli}.js`; and a shard failing at "Start database" with Docker Hub
`connection reset by peer` is a pull flake, no test ran.

**Deep review round 2 (2026-09-16), fixes landed `159495b2b9`, CI green 81/81.**
The unbounded ask had a real hole: pm2's axon socket reconnects to a daemon
started in the old one's place ON ITS OWN, so `readPool` keeps being answered
and no bounded call ever times out — the scale left waiting in the autoscaler
is never answered and never failed, and asked-once-at-a-time means never
re-asked. Proven by a bb arm (`autoscale-prewarm-health` arm 4, `pm2 kill` +
start at 3/8 → pool stayed 1 on the first run). Fix: `scaleApp(app, n,
timeoutMs)` takes its bound like `reloadApp`; the prewarm passes
`(target - workers + 1) * listen_timeout` — pm2 waits `listen_timeout` at most
per added worker (3 s default in prod → 45 s for 15), so an ask unanswered past
that is one whose daemon is gone. `requestScale` is client-internal again. The
client also fails its unbounded in-flight calls on a reconnect (`outstanding`
set). Restart gate `carriesRestarts === false || prewarmBegun`. Boot's flush
wait got its own `CACHE_AUTO_FLUSH_ON_DEPLOY_TIMEOUT` (30s) because a consumer
sets `CACHE_FLUSH_TIMEOUT=120s` for the CLI. Health arm file now ~223 s (hint
260_000); load arm 41.7 s, curve `1 2 3 4 5 6 3 2 1` reproduced.

**Deep review round 3 (2026-09-16), fixes landed `33e6e47d60`.** pm2 clocks
`listen_timeout` from the worker's `online` event (`God.js:314-324`), so each
fork's spawn→online is uncounted; round 2's bound gave 14 prod forks 3 s in
total. Two doors to the same overshoot (second scale mid-chain adds on top,
≤ 28 workers): the tight bound, and `readPool`'s 15 s bound giving up on a
live-but-starved daemon (the `outstanding` set then fails the ask). Fixes:
bound = `(target - workers) * listen_timeout + SUPERVISOR_TIMEOUT_MS`
(prod 57 s, fixture 85 s), and a re-ask gate — `poolGrewAt` stamped when
`online + pending` grows (a fork), no ask while `now - poolGrewAt <
2 * listen_timeout` (a live chain forks at least that often). Not covered,
disclosed: an autoscaler restarted mid-fill asks on its first tick with no
growth seen. Unit `pool(count, listenTimeout)` fixture; arm 4 derives its
bound from rig exports `WORKER_LISTEN_TIMEOUT_MS`/`SUPERVISOR_TIMEOUT_MS`.

**Merged 2026-09-16 as `9cdfbde9e2`** (`#490` auto-closed). Fork `-dist` rebuilt to
`df934ae588`. The consumer-side bump and deploy are in the consumer repo's
memories; that deploy did not exercise the prewarm (the 2026-09-15 hand-set
`PM2_AUTOSCALE_PREWARM=0` stays until jean deletes it post-deploy).

