---
name: project_directus_pr456_autoscaler_design
description: PR #456 (issue #455) landed autoscaler design — app-not-module verdict, three-layer instant rollback, legacy strategy reproducing pm2-autoscale exactly, windowed CPU smoothing, resolve-config outage semantics, two Redis-outage bugs found and fixed
metadata:
  author: Jean Claveau
  type: project
---

Supersedes the design-stage rationale in [[project_directus_issue455_fork_autoscale]] —
this is what actually landed on `v11.10.1-feat/autoscaler` (PR #456,
`.wt-autoscaler`).

**pm2 app, not pm2 module — measured, not assumed.** User asked to evaluate a
module-as-symlink form. Verdict: no.
- `pm2 install .` is dev-mode-with-watch; the only prod paths are registry or `pm2
  package` → tarball → copy into `$PM2_HOME/node_modules`, needing a shim requiring an
  absolute path back into the api package.
- List hygiene doesn't need it: `Client.list` doesn't filter modules (only `pm2 ls`'s
  UX does, on `pm2_env.pmx_module`) — confirmed live via scalabus-dev MCP
  `list_processes`, the pm2-autoscale module already renders as a non-answering row.
- Live config is already better in Redis (one write, whole fleet) than `pm2 set`
  (per-daemon).
- Hotplug is the one that fails the actual constraint: `pm2 uninstall && install` needs
  `railway ssh` into each replica while traffic is live — not instant, a rolling
  manual op with a mixed-scheduler window.
- Cost: as an app, `PM2_AUTOSCALE_*` flows through the same `readEnv` → `apps[].env`
  chain the api uses; as a module it would only see the pm2 daemon's env, needing a
  second delivery route.

**Three-layer instant rollback**, none needing a redeploy or a shell, all one Redis
write to `${CACHE_NAMESPACE}:config:processes:autoscale`:
1. `{"enabled": false}` — freezes the pool, covers a defect anywhere including sampling.
2. `{"minWorkers": N, "maxWorkers": N}` — pins the pool at a known-good size.
3. `{"strategy": "legacy"}` — reverts the decision rule to what pm2-autoscale did.

**`legacy` strategy reproduces pm2-autoscale 1.4.0 from its actual installed source**
(`~/.pm2/modules/pm2-autoscale/node_modules/pm2-autoscale/core/{pm2,app}.js`), not from
memory: max CPU to grow / average CPU to shrink, release test nested in the growth
test's `else` (a pool on its add-cooldown does not fall through and shrink), 30-sample
per-pid rolling window (`LEGACY_SAMPLE_WINDOW`), free-memory brake, strict-`>` whole-
second cooldowns re-armed by pid appearance/disappearance, no warm-up exclusion, no
churn freeze, no prewarm. Two knowing departures (documented in `decideLegacy`'s doc):
cooldown clocks start with the autoscaler rather than at zero, and config comes from
this autoscaler's chain (no `max_workers: 'max'`).

**Windowed CPU smoothing was a real product gap found while chasing a CI flake, put to
the user rather than decided unilaterally.** `scalabus` originally decided on one
instantaneous `pm2 list` CPU reading where the module it replaces averages 30 — strictly
more reactive in both directions (a spike buys a worker; a single low sample releases
one under load) — a behaviour change nobody asked for. User: "short window for now."
Landed as `PM2_AUTOSCALE_SAMPLE_WINDOW` (default 5), one ring (`PoolSamples`, keyed by
pid so a restart starts fresh) shared by both strategies — `scalabus` reads
`sampleWindow`, `legacy` stays fixed at 30. **Subtlety that would have silently undone
it:** warm-up samples must be dropped from the scalabus mean, not folded in, or a
worker carries its own boot CPU into the window for another `sampleWindow` ticks after
being declared warm — forced `mature` to become a per-sample property (`OnlineWorker.mature`,
`readPool` reports it per worker) rather than a pre-filter.

**`resolve-config.ts` outage semantics — deliberate, and the PR body got it backwards
(see [[project_directus_pr456_open_items]]):** `return lastGood ?? settle(fromEnv)` —
a Redis that stops answering **holds the last configuration it read**, it does NOT fall
back to env. Reverting to env sounds safer and isn't: an operator who just raised the
ceiling to survive a spike would have it dropped by a blip, with no cooldown on a
ceiling correction, so the pool sheds workers immediately and retakes them on
reconnect. Env chain is only reached when nothing was ever successfully read.

**Two independent Redis-outage bugs found and fixed while building the coverage the
user asked for** ("do we have some test simulating loosing the redis connection"):
1. **Freeze (`c19168832b`).** The shared ioredis client has its offline queue enabled
   (only the Keyv cache clients get `disableOfflineQueue: true`), so a command issued
   while reconnecting queues with no deadline — measured a `get` still pending after 5s
   against a dead port. The tick's first statement is `await resolveConfig()`, so an
   outage didn't fall back to anything, it stopped the loop dead: no decisions, no
   logs, pool frozen. Fix: the read is skipped outright while the client reports
   `reconnecting`/`close`/`end`, else raced against a 1000ms deadline (the sample
   interval, so a read is never why a tick is late); the losing promise gets its own
   `.catch` or the flushed-queue rejection would kill the process.
2. **Death (`ea2c951a4a`).** `directus autoscale` **dies** during a Redis outage —
   unhandled rejections from the bus/ioredis are fatal by default, and this long-running
   CLI command never registered the `unhandledRejection` guard `startServer` registers
   for the API. Measured driving the rig directly: 7 rejections per queue flush,
   process exits code 1 ~40s in (later corrected to 10.5s: 20 retries of `50ms ×
   attempt` capped at 2000ms). In prod pm2 just restarts it back into the same outage —
   pool unmanaged, frozen wherever the failure caught it. **General lesson for this
   fork: any long-running non-HTTP process needs the same unhandledRejection guard as
   `startServer` — being a server isn't what earns it, outliving a background
   dependency is.**
3. **Boot-path variant of the same issue (`6e68f31c30`), found when re-auditing
   [issue #463](https://github.com/jclaveau/directus/issues/463) for autoscale
   instances.** `runAutoscaler` `await`ed `initProcessReports()` (subscribes over the
   shared client) before entering its loop — a boot into an outage burned the whole
   retry budget before the first decision. Made fire-and-forget with the same catch:
   first scale moved from 21s to 9s after boot (8s warm-up + one tick).

**Issue #463 (shared ioredis offline queue) — deliberately split by intent, not
folded into #456.** The two autoscale-specific instances are fixed narrowly (both call
sites that were blocking a loop that must not stop); the shared client's
`enableOfflineQueue` default is untouched and still affects `scoped-cache`,
`cache-events`, `permissions/cache`, `create-metrics`, and the bus/lock through
`@directus/memory`. Rationale given to the user: flipping the shared default is a
behaviour change for cache/bus/lock/metrics at once, each needs its own decision about
an immediate rejection, and that's an audit + its own blackbox evidence — not a
one-liner riding on "the fork owns its autoscaler". Also throttled
`reportUnhandledRejection` while there (`d2cbcf4367`): one line per distinct failure
per minute, keyed `name: message`, map capped at 100 distinct entries; the line that
ends a window reports what it swallowed, and the metric still increments on every
rejection so throttling the log doesn't lose the count.

**A renaming worth the principle, not just the diff:** `heldAt` (boolean) →
`sizesOver` (distinct sizes in first-seen order) + `decisionsOf(rig)` (the autoscaler's
own log lines). A boolean "did it hold" collapses "grew" and "dipped-then-recovered"
into the same `false` — useless for diagnosing a flake. The array-of-distinct-sizes
form plus the decision log makes the CI failure self-explaining on the next run instead
of needing another guessing round. Same instinct behind later adding `restarts` to the
same assertion (`restartsOf(rig)`, renamed from `restartCount`) — a growth decided on a
CPU spike (`decisions` carries `cpu: 9x`) and a `wait_ready` double-count
(`restarts>0`, empty `decisions`) look identical on a bare boolean but are different
bugs.
