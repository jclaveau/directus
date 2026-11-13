---
name: reference_directus_pm2_reload_internals
description: pm2 v7.0.1 `reload` source-verified internals — how new-before-old actually works, why `{env}` options are silently dropped, and the PM2_JSON_PROCESSING+current_conf route that gets a live option change through anyway
metadata:
  author: Jean Claveau
  type: reference
---

Researched from pm2 v7.0.1 source (not docs) while building PR #467's rolling
restart button. Directus declares its pm2 app with `wait_ready: true` and no
`instances`/`exec_mode` override (defaults `1`/`cluster`).

**`reload` genuinely brings the replacement up before retiring the old worker.**
`God.reloadProcessId` → `hardReload`, per worker: (1) the old worker is moved
aside to pm id `_old_<n>`, still serving; (2) `God.executeApp(new_env)` spawns
the replacement; (3) a bus listener waits for `packet.raw === 'ready'`
(`wait_msg = pm2_env.wait_ready ? 'ready' : 'listening'`); (4) only inside that
callback does it call `God.deleteProcessId('_old_<n>')`. `ready` is a real
signal here — Directus's `api/src/server.ts` sends it from inside the `listen`
callback.

**The wait is capped by `listen_timeout` (default 3000ms via
`cst.GRACEFUL_LISTEN_TIMEOUT`)** — the same constant also caps `launching →
online` at process boot (`lib/God.js:317-324`). If boot time exceeds it, the
guarantee above becomes false in practice: the old worker is retired *before*
the new one is actually ready. Directus's own measured boot is ~3.26s, so an
unset `listen_timeout` silently degrades every reload to stop-then-start.

**`gracefulReload` is unusable with `wait_ready: true`.** `softReloadProcessId`
gates on `!wait_ready`; with it true, pm2 falls through to `restartProcessId` —
plain stop-then-start, the opposite of what's wanted.

**Rolling, not all-at-once.** `_operate` → `async.eachLimit(ids, CONCURRENT_ACTIONS)`,
default 2 (forced to 1 at ≤2 process ids). Peak pool size during a reload is
N+CONCURRENT_ACTIONS. `Common.lockReload()` makes a concurrent reload attempt
return `Error('Reload in progress')` rather than queue or interleave.

**`API.reload(name, opts, cb)` REJECTS `opts.env` outright** —
`'Using --env [env] without passing the ecosystem.config.js does not work'`.
The intuitive `pm2.reload(name, { env: {...} })` route to push a live option
change is dead on arrival; do not build toward it.

**Even `current_conf` at the top level is normally dropped.** `_operate` calls
`_handleAttributeUpdate(envs)` → `Config.filterOptions`, which copies **only
keys that have an `alias` in pm2's own CLI option schema**. Of pm2's ~65 schema
keys, only 10 have aliases (`script`, `exec_interpreter`, `node_args`,
`out_file`, `error_file`, `log_file`, `pid_file`, `cron_restart`,
`merge_logs`, `uid`) — none of the six options actually wanted here
(`kill_timeout`, `listen_timeout`, `max_memory_restart`, `min_uptime`,
`max_restarts`, `restart_delay`) are aliased, so a plain `current_conf` object
is silently filtered away before it ever reaches the worker.

**The working route: set `process.env.PM2_JSON_PROCESSING` truthy, then call
`pm2.reload(appName, { current_conf: declaration })`.** `_handleAttributeUpdate`
is skipped entirely when that env var is truthy, so `filterOptions` never runs
and the whole `current_conf` object survives. `_operate` only synthesizes its
own `current_conf` `if (!envs.current_conf)` (and would add `km_link` in that
path), so supplying one preempts that. `Utility.extendExtraConfig(proc, opts)`
→ `extendMix(proc.pm2_env, opts.env.current_conf)` merges it into the app's
pm2_env; `extendMix` treats the string `'null'` as "delete this key" (a real
gotcha if a value round-trips through JSON.stringify carelessly). `hardReload`
then clones `new_env = Utility.clone(old_worker.pm2_env)` **after** that merge,
so the pushed values (including a pushed `listen_timeout`) apply to the very
roll that carries them. `PM2_JSON_PROCESSING` is read synchronously while
`reload()` is still on the call stack, so it's safe to flip it right before the
call and restore it in a `finally` immediately after, scoped tightly around
just that call.

**Why not risk env pollution instead of the flag dance:** `Utility.extend(dest,
src)` skips a value unless `String(src[k]) !== '[object Object]'`, so passing a
plain object never leaks into `pm2_env.env` even without the flag — but it also
means a naive object literal for `opts.env` gets silently ignored rather than
throwing, which is an easy way to ship something that looks like it works and
does nothing.

**Consequence for a "declare it once, mutate it forever" design:** because pm2
keeps whatever the *last* roll pushed, a live-editable subset of the
declaration must always resend the full managed set on every restart (env
fallback where nothing is stored), not just the fields with an active
override — otherwise clearing a stored value has no way to ever take effect;
pm2 has nothing to fall back to on its own.

**`instances` and `exec_mode` cannot be reached this way at all** — they aren't
in the reload merge path in any pm2 version; changing pool size or exec mode
needs `pm2 scale` or a full delete+start, never a reload.

**Why, precisely (checked 2026-09-11 answering "why can't `PM2_INSTANCES` be
changed once pm2 started"), three stacked reasons:**
1. `ecosystem.config.cjs`'s `instances: process.env.PM2_INSTANCES ?? 1` is
   read once by the pm2 **CLI** at `pm2 start`, in the shell that launches the
   daemon — the number is copied into the daemon's in-memory app declaration
   and the env var is never consulted again. Editing it afterwards changes a
   string nothing reads (on Railway, only a redeploy re-reads it — which
   restarts the whole pool anyway).
2. `_operate` (`API.js:1354`, `reload`'s own code path) resolves the app to
   its **existing** process ids and does one action per id
   (`eachLimit(ids, ...)`). Per-worker settings genuinely change through this
   (`listen_timeout`, `kill_timeout`, `max_memory_restart` via
   `current_conf`), but `instances` is a property of the *app*, not a
   per-worker setting — no iteration over existing ids can add or remove a
   member of that set. Putting it in `current_conf` is inert, not merely
   filtered.
3. Adding/removing workers is a different action entirely — `scale`
   (`API.js:1792`) calls `duplicateProcessId`/`deleteProcessId`. This fork's
   autoscaler already owns that path, which is *why* `PM2_INSTANCES` is kept
   out of the editable-settings surface on purpose: if a reload could set the
   pool size it would fight the scaling loop and lose within one tick (the
   loop re-derives size from `minWorkers`/`maxWorkers`/`prewarmWorkers`
   every time). Escape hatch that exists and isn't used: `pm2 reload
   ecosystem.config.cjs --update-env` re-reads the file with the current env
   — but it's a CLI path over a file, not this code's programmatic
   `reload(appName, …)`, and the loop would still overwrite the win on its
   next tick.

Sibling case: `PM2_EXEC_MODE` is in the same non-editable class for a harder
reason — only a cluster can be scaled at all, so a pool in `fork` mode is one
the autoscaler cannot move regardless of what any layer says.

Built out in [[project_directus_pr467_autoscale_config_surface]] (the rolling
restart button and the editable supervisor options) and
[[project_directus_shared_settings_source_of_truth]] (issue #473, PR #475 —
the settings layer this question came up while reviewing).
