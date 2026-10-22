---
name: project_directus_pr456_open_items
description: PR #456 (autoscaler) — MERGED 2026-09-15 as 9b5fd83f7e with every listed item closed; kept for the defects it found and how each was proven
metadata:
  author: Jean Claveau
  type: project
---

**MERGED 2026-09-15 as `9b5fd83f7e`** (a merge commit, so the branch's own SHAs
stay reachable), closing fork issues #473, #482 and #484 — the last two only
because `Closes` keywords were added to the body at the eleventh hour; neither
would have closed itself. Everything below is closed. See
[[project_directus_pr456_autoscaler_design]] for what these refer to, and
[[project_directus_autoscale_legacy_rollback_smoke]] for the rollback lever
exercised live on the preview the hour before the merge.

Still open and deliberately out of scope: #455 items 1-2 (decision
observability, memory-derived ceiling), #457 (proportional release), #463
(the shared client's offline queue), #483 (RSS victim ranking).

**1. PR #456's body — FIXED 2026-09-09** (PATCHed, admin-preview footer spliced from
the live body). It had stated "Redis unreachable falls back to the env chain and warns once per
outage." That is the opposite of what `resolve-config.ts` does (holds last-good
config; env chain only if nothing was ever read). Also missing from the body: the
`legacy` strategy, the three-layer rollback (the PR's actual headline safety
property), windowed CPU / `PM2_AUTOSCALE_SAMPLE_WINDOW`, the bounded Redis read, the
`unhandledRejection` survival guard, the boot-path fix, and the two new bb suites.
`ea2c951a4a`'s commit message also says "~40s" for the queue-flush death; the measured
figure is 10.5s (20 retries × `50ms × attempt`, capped 2000ms) — correct when editing
the body rather than force-pushing over running CI. Hold the edit until the admin
preview settles (editing the body cancels the in-flight preview,
[[feedback_directus_redispatch_preview_freely]]).

**2. `autoscale-config-source` hold arm — ROOT-CAUSED AND FIXED 2026-09-09** in
`49c6c9f877`. 3 failures in 5 runs, and neither of the two theories tested before it
(boot-CPU-is-cumulative, runner contention). pm2 reports CPU as a delta since
whichever client last listed, and the suite polls the daemon 4x a second beside an
autoscaler polling once — a fixed 10-20ms offset makes every sample read 100% against
a threshold of 95, for the whole run. Measured sweep in
[[project_directus_pm2_cpu_delta_window]]. Fixed by removing the dependence rather
than retuning it: the hold arms pin the pool with `minWorkers === maxWorkers`, which
leaves `decide` no branch returning a size, and the overrides carry the room they
need. `decide.test.ts` pins the property. **The production half is fixed as well**, in
`e47214c5ea`: `WorkerCpu` reads each worker's `/proc` CPU counters against its own
previous reading, so no other client of the daemon can shorten the window the
autoscaler measures over.

**3. The `unhandledRejection` guard — DONE**, `fb59a48cf1` on #467's branch (which
bases on #456, so it lands here first). No split was needed: `index.test.ts` already
drives the infinite loop with a `ticks()` helper under fake timers, so the guard is
reachable exactly like every other boot step. The "splitting the boot out of the loop"
worry was wrong.

Two arms, because the one line carries two claims: the guard is up **before**
`connectToSupervisor` can reject (asserted from inside a `mockImplementationOnce`,
which is the only place that ordering is observable), and it is registered **once at
boot rather than once a tick**. `afterEach` hands the listener back beside the SIGINT
and SIGTERM handlers — which is also what lets the second arm count. 3/3 mutants
caught: guard deleted, guard moved after the connect, guard moved inside `for(;;)`.

Do NOT emit `process.emit('unhandledRejection', …)` to test this: vitest keeps its own
listener and reports the synthetic rejection as an unhandled error, failing the file
with every test passing — the same shape as
[[reference_directus_vdialog_focus_trap_tests]]. Asserting on `process.listeners()` is
what stays inside the harness.

**4. Codecov's aggregate patch gate — RESOLVED.** At head `e171705a54` the PR is
green end to end: `codecov/patch` SUCCESS, all 9 blackbox shards SUCCESS,
`MERGEABLE/CLEAN`. The table below is the historical measurement that guided the
work, kept for where-the-misses-were.

Was: red and needing ~230 more covered lines. bb-heavy ([[project_directus_coverage_bb_vs_unit_split]]), and only unit
tests move the aggregate. Measured at head `268c439fc1`: 727 patch lines, 256 missed,
**64.78% against a 95% target** — up from 58.63% at `59cb276bc3`, which the `pool.ts`
bound and its unit file raised. Where the misses are, so the next pass starts at the
big one rather than the nearest:

| file | lines | missed | coverage |
| --- | --- | --- | --- |
| `api/src/autoscale/index.ts` | 133 | 133 | **0%** |
| `api/src/autoscale/lib/decide.ts` | 151 | 71 | 52.98% |
| `api/src/autoscale/lib/pool.ts` | 99 | 39 | 60.6% |
| `api/src/autoscale/lib/resolve-config.ts` | 152 | 10 | 93.42% |
| `api/src/utils/report-unhandled-rejection.ts` | 31 | 1 | 96.77% |
| `sanitize-config.ts`, `pool-samples.ts`, `types.ts` | 148 | 0 | 100% |

`index.ts` alone is over half the gap and carries the loop and the bootstrap, which
today only blackbox reaches. Read these per file from
`https://api.codecov.io/api/v2/github/jclaveau/repos/directus/file_report/<path>?sha=<40-char head>`
— a short sha is rejected with "not in our records", and the `line_coverage` array
does not decode as `[line, hits]`, so trust `totals` and not a hand-rolled miss list.

**Three bb scenarios queued next, ranked by the user's "all three", highest-value
first:**
1. **Losing the pm2 daemon mid-run** — `connectToSupervisor()` runs once at boot, the
   loop never reconnects; a `pm2 kill`/restart (God daemon death, OOM, the planner's
   nightly `cron_restart`) makes every `readPool` throw, swallowed by the per-tick
   catch, forever, silently. Same failure class as the Redis freeze (alive but not
   working). **This WAS a defect, and the "self-recovers" reading recorded here on
   2026-09-08 was wrong** — it recovers most of the time, which is all a one-shot
   check can see. Root-caused 2026-09-09 from the arm's own intermittency: a pm2 call
   whose daemon dies between the send and the reply is neither answered nor failed,
   and `readPool`/`scaleTo` awaited it bare, so the tick froze permanently and
   silently. Measured 3/3 on a `pm2.scale()` killed mid-flight, and on the frozen
   autoscaler itself (alive, `ep_poll`, zero CPU ticks over 3s). Fixed in `c21cb32c0a`
   with a 15s bound plus reconnect — see
   [[project_directus_autoscaler_supervisor_call_freeze]].
2. **Release under falling load — DONE**, `676f11e56b`
   (`autoscale-release.test.ts` plus the worker's `BB_CALM_AFTER_MS` knob), on the
   #456 branch itself. Grows 1→3, walks back to 1, then holds at the floor for a
   10s window. `releaseCpuThreshold` shipped at 5 under a scale threshold of 10,
   so the clamp correction noted below was not needed.

   Original entry: — the exact mechanism that caused the two production
   incidents this feature replaces (max-triggered add vs average-gated release,
   permanently tripped by background CPU). No existing bb arm proves a pool that grew
   because it was hot comes back down once the heat goes; the closest
   (`prewarms above the floor, then releases back to it`) exercises the ceiling
   correction, not the release rule. Needs a `BB_CALM_AFTER_MS` fixture-worker
   parameter. First result at session end: grows 1→2→3 at 10s, calms, releases 3→2→1
   at 41s, held — with one clamp correction needed (`releaseCpuThreshold` 5→4, was
   getting clamped below the scale threshold).
3. **The other two rollback levers — DONE**, `953459e4ed`, as three arms at the
   end of `autoscale-config-source.test.ts`: the `minWorkers = maxWorkers` pin
   (comes down to it AND does not climb back), `enabled: false` holding a pool
   against an override it would otherwise obey, and the same override re-enabled
   to prove the freeze was the flag. Also on the #456 branch.

   Original entry: **The other two rollback levers, unproven end-to-end.** `strategy: legacy` is
   proven live (the switch arm in `autoscale-legacy.test.ts`); `{"enabled": false}` and
   the `minWorkers = maxWorkers` pin are unit-covered (`decide.test.ts`) but nothing
   writes either to Redis mid-run and watches a hot pool actually stop — and these are
   the PR's headline "reach for this at 3am" levers.

**All three queued scenarios have landed, and so has item 3.** What is left of this
list is item 4 (the codecov aggregate), plus:

Lower-value, explicitly deferred — **both DONE 2026-09-15**, `d5a9dc4594` and
`2b37174c0c`: churn starting *from* the ceiling rather than a calm pool
(`autoscale-churn.test.ts`, 1 arm) and `signal: max` end-to-end
(`autoscale-signal.test.ts`, 2 arms — the same lopsided pool held under `average`
and grown under `max`). Both passed on their first CI execution, 35s and 54s
against 70s/130s hints, so the weights over-reserve and could come down.

**The body was refreshed again 2026-09-15** for three staleness points the
collapse of #467 and the green codecov left behind: "Nothing writes the override
yet" (there is an admin surface now — what is still missing is decision
observability), "Patch coverage will be red" (it is green; the unit tests carry
the gate), and the two new blackbox files. `Closes #482` and `Closes #484` were
added at the same time — both are fixed on the branch (`275ea4ed0d`, and
`averageOver(cpuPercents, survivors)` in `decide.ts`) and neither would have
closed itself on merge.

**The admin surface #456's body defers is now built**, stacked in **#467**
([[project_directus_pr467_autoscale_config_surface]]) — so #456's "Nothing writes
the override yet. An admin surface for it belongs with the decision observability,
which is also deferred" wants a pointer to #467 the next time its body is edited.
Hold that edit while a preview tunnel is live on the branch
([[feedback_directus_redispatch_preview_freely]]).

**Longer-standing, untouched this window:** #457 (proportional release), #455 items
1–2 (decision observability, memory-derived ceiling) from
[[project_directus_issue455_fork_autoscale]]'s original sequencing.
