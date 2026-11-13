---
name: project_directus_pm2_cpu_delta_window
description: pm2 reports a worker's CPU as a delta since whichever client last listed, so a second poller 10-20ms earlier turns a 20% worker into a 100% one
metadata:
  type: project
---

pm2's `monit.cpu` is not an instantaneous reading and not an average over a
fixed window. The daemon computes it with pidusage, whose delta window runs
from **whenever any client last asked about that pid** — so a second client
listing the same daemon decides what window the next reader measures over.

Measured 2026-09-09 against the blackbox autoscale fixture (spins 20ms in
every 100ms, so its true duty cycle is 20%), one list run a fixed gap before
another, 12 rounds per gap:

| gap before the read | reported CPU |
| --- | --- |
| 0 ms | 0 |
| **10 ms** | **0 – 100** |
| **20 ms** | **0 – 100** |
| 30 ms | 0 – 66.7 |
| 50 ms | 0 – 40 |
| 100 ms | 18.2 – 20 |
| 250 ms | 15.4 – 24 |
| 1000 ms | 16.7 – 20 |

A window shorter than one burst reports whatever that window landed on. Below
about 30ms it is a coin toss between 0 and 100; from 100ms up it is the duty
cycle.

**The phase is what makes this bite, not chance.** Two pollers on steady
timers hold a constant offset, so a bad gap is bad for the whole run rather
than for the occasional tick. That is what made `autoscale-config-source`
fail 3 runs in 5 while never reproducing on an idle laptop: `sizesOver` polls
`pm2 jlist` 4x a second beside an autoscaler listing once a second, and an
offset in the 10-20ms band made every sample read 100% against a threshold
of 95. Two earlier theories — boot CPU (warm-up raised 2s to 8s) and runner
contention (8 cores saturated) — were tested and refuted first.

Fixed in the suite by removing the dependence rather than retuning it: the
arms that assert a hold pin the pool with `minWorkers === maxWorkers`, which
leaves `decide` no branch that returns a size, so what the pool reports stops
mattering. Pinned by a unit test in `decide.test.ts`.

**The production half is fixed too, in `e47214c5ea`.** A median over
`sampleWindow` plus tick jitter was considered and dropped: a median still
loses under a sustained phase lock, and jitter only makes the lock improbable.
The autoscaler stops sharing the measurement instead — `api/src/autoscale/lib/
worker-cpu.ts` reads each worker's `utime`/`stime` from `/proc/<pid>/stat`
against its own previous reading, over a window no other client can shorten.
Same counters pm2 reads, same scale (100% is one core), so thresholds keep
their meaning; where `/proc` will not answer the supervisor's number stands.
Against the same sweep the reader holds 17.9 - 21.6 at every gap while pm2
swings 0 - 100.

Parsing `/proc/<pid>/stat`: field 2 is the unquoted executable name and may
carry spaces and parentheses, so the fields are located from the **last** `)`.
After the pid and comm the list starts at `state`, which puts `utime` (line
field 14) at index 11, `stime` at 12 and `starttime` (22) at 19; `USER_HZ` is
100 on Linux.

The `legacy` strategy keeps pm2's own number and its mean, since it reproduces
pm2-autoscale 1.4.0 exactly. See [[project_directus_pr456_open_items]] and
[[project_directus_autoscaler_supervisor_call_freeze]].
