---
name: project_directus_issue455_fork_autoscale
description: Issue #455 — replace pm2-autoscale with a fork-owned autoscaler; ORIGINAL design decisions and why it's a rewrite not a fork-of-a-fork. Superseded for current state by [[project_directus_pr456_autoscaler_design]] and [[project_directus_pr456_open_items]] — PR #456 has since landed the app, legacy strategy, three-layer rollback and windowed CPU
metadata:
  type: project
---

**⚠️ 2026-09-08: PR #456 has since landed most of this design.** For what actually
shipped (app-vs-module verdict, three-layer rollback, `legacy` strategy, windowed CPU,
resolve-config outage semantics, the two Redis-outage bugs) see
[[project_directus_pr456_autoscaler_design]]; for what's still open see
[[project_directus_pr456_open_items]]. This memory is kept for the original rationale
below (dormant upstream, Directus-coupled prewarm signals) which is still the reason
a rewrite was chosen — prewarm itself (`PM2_AUTOSCALE_PREWARM`, ready-event gating) had
not landed as of the PR #456 session.

Triggered by [[project_directus_pm2_autoscale_threshold_ratchet]] and
[[project_directus_worker_heap_cap_incident]] on 2026-09-08. Decision: **write a fresh
package in the Directus fork, not a fork of `pm2-autoscale`.**

**Why a rewrite, not a fork-of-a-fork (settled, don't re-litigate):**
- Upstream `pm2-autoscale` is dormant (last publish 2024-08-14, 13 versions then 2 years
  silent) — no one to merge a PR back to.
- What's wanted changes the *design*, not bugs: max-triggered add vs average-gated
  release, release trapped in the add check's `else` branch (unreachable while max is
  over threshold — confirmed from source, not "drains slowly", it doesn't drain at all
  while hot), and boot size == floor being the same number (`getDefaultWorkersCount()`
  is literally `instances`) so "start big, may fall low" is structurally impossible today.
- Every motivating feature is Directus-coupled: prewarm has to gate `/server/health`
  (reuses the [[project_directus_migration_deploy_data_loss_window]] health-hold
  mechanism), config comes from the fork's Redis + env conventions, observability lands
  on the fork's Processes page, and better signals (event-loop lag via the pressure
  limiter, DB pool `numPendingAcquires`) live inside Directus workers — a standalone pm2
  module can only ever see the process table.
- Licensing: upstream MIT, fork additions BSL-1.1 — writing fresh avoids permanent
  MIT-notice bookkeeping on a file being substantially rewritten anyway.
- Testability: today's failure was a decision rule nobody could unit-test; in-tree it
  sits next to the fork's own test infra.

**Design constraint to hold:** keep the decision function **pure** —
`(samples, config) -> action` — with pm2 behind a thin adapter. Makes the rule testable
without a supervisor, makes the CPU signal swappable for something better later, and
keeps the door open to extracting it if it ever proves generally useful.

**User-specified requirements beyond the original sketch:**
- `PM2_AUTOSCALE_PREWARM` env var: boot N workers on deploy explicitly (workers die
  naturally if no load hits them) — better than a Redis-remembered pool size, which
  would faithfully reproduce a past misconfiguration (e.g. the 21-worker ratchet
  plateau) as policy on every future deploy.
- Prewarm gating on Directus's own `ready` event is more robust than a blind
  `min_seconds_to_add_worker` wait: `api/src/server.ts:211` calls `process.send('ready')`
  inside the `listen` callback, and the consumer's ecosystem config already sets `wait_ready: true`,
  so pm2 already knows exactly when a worker is accepting connections — confirmed from
  source. Caveat: **ready is not warm** — a just-started worker has a cold schema cache
  and unJITted hot path, so its CPU stays elevated right after. Pacing on ready alone
  would let that elevated CPU trigger the next add (this incident's mechanism again).
  Rule should be *ready AND that worker's own CPU under threshold*, with a short settle
  window as backstop rather than primary signal.
- Prewarm must run in an explicit **warming state** where the autoscaler makes no
  scale decisions until the prewarmed pool is online and CPU has settled — otherwise
  live scaling sees the prewarm's own boot CPU (boot is ~87% module loading, see
  [[project_directus_boot_cost_shape]]) and adds workers on top of it.
- Target pool size for prewarm (if ever remembered rather than fixed) must be a smoothed
  rolling value (e.g. 15-min median), never the instantaneous count.
- Ceiling should derive from real cgroup memory limits (the fork's `host-capacity.ts`
  from #447 already reads them), not a hand-picked `max_workers` — `os.freemem()` in the
  current module reads the container **host's** memory and never blocks anything.
- Prewarm is a rollback risk: a bad deploy now boots N workers before failing instead of
  1 — needs a measured, hard-capped prewarm time that falls through to healthy
  regardless, and Redis-down-at-boot must fall back to `PM2_INSTANCES` and never block
  (fork already paid for this lesson once, [[project_directus_redis_outage_kills_process]]).

**Ship the current module pinned, independent of the rewrite:** `pm2 install
pm2-autoscale` runs on the consumer's `prepare` lifecycle script
— fires on *every* `pnpm install`, not just image builds, fetches from npm unpinned with
**no lockfile entry**. It is the single component that took prod down. Baked into three of the
consumer's Dockerfiles. Shipping the fork's own package as a `directus autoscale`
subcommand removes the network layer, the unpinned-version risk, and the module-store
plumbing (`pm2 set`, `PM2_HOME` module store) in one move — planned to land before the
full rewrite as an isolated pin-first step.

**Ruled out:** `pm2 set <module>:<key>` as a live-knob mechanism — the module's `conf`
closure is captured once at `initModule`, and `PM2_HOME` is ephemeral per deploy, so a
seeded value silently reverts on the next deploy.

**Sequencing agreed:** decision-signal observability first (additive, would have caught
today in minutes) → memory-derived ceiling (safety rail, correct regardless of tuning) →
fork's autoscaler with Redis-live-config-with-env-fallback → prewarm last (needs the
other three correct to be trustworthy). User then asked to attack #455 directly in one
PR: **bb tests only, no unit tests, testing the ramp under different configs and the
Redis-vs-env config resolution** — work was started (isolated worktree, pure decision
function + config resolution + pm2 adapter written) but not landed within this session.
