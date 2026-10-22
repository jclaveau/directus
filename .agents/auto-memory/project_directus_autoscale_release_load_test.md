---
name: project_directus_autoscale_release_load_test
description: What a preview load test can and cannot prove about an autoscaler release, measured 2026-09-14
metadata:
  type: project
---

Two load tests on a consumer's PR preview on 2026-09-14 exercised the
autoscaler's grow and release paths against `/server/specs/oas`.

Pass 1 (23:38–23:43) and pass 2 (23:49–23:58) both fired both paths:

```
23:49:27  api 1 -> 2 workers: average cpu 77% >= 70%. cpu: 77. restarts: 0
23:54:29  api 2 -> 1 workers: cpu 11% across the 1 worker(s) a release leaves < 40%. cpu: 4,7
```

Grow reads the pool **average** (#456's convergence), release is judged on the
workers it would **leave** (#484). Both confirmed live.

Pass 2 was shaped to keep requests in flight through the release: 200 s ramp
with 32 burners, then 360 s with 2 burners and 8 probe streams still running.
The release landed 107 s into the fall phase, `PM2 log: Stopping app:api id:2`,
with probes continuously in flight. **9195 probes, 0 non-200**, worst latency
5.5 s five seconds after the stop.

**This DID exercise #482's fix.** The preview pins
`v11.10.1-feat/autoscaler-dist` at `f300b64e58` (2026-09-14 21:56 UTC), which
carries `275ea4ed0d fix(autoscale): stop the worker that is idle, not the one pm2
picks` — so `chooseVictims` was live two hours before the run. The tell is in the
log: pm2's own `rmProcs` walks from the lowest `pm_id`, and the release stopped
`id:2`, the worker just grown, not the older one holding the keep-alive sockets.

What the run does **not** prove is the drain budget underneath it.
The consumer's ecosystem config sets `kill_timeout: 25000` and every request here
finished inside 6 s, so a graceful drain would have covered these requests even
had the victim been chosen badly. The 2026-09-13 502 needed a request that
outlived the kill timeout — it held a 27 s `POST /items/<collection>`. Both
halves have to fail together, so exposing a regression in either needs a request
longer than 20 s, not more concurrency.

Analysis traps hit on the way: the probe file is
`timestamp http_code time_total tag` (four fields, not three), and uutils
`date -u -d '<local string>'` parses in the box's local zone despite `-u`, so
pass `TZ=UTC` explicitly when converting a log timestamp to an epoch.

Related: [[project_directus_autoscale_release_judgement]],
[[project_directus_autoscale_in_flight_signal]],
[[project_directus_pm2_autoscale_ramp_measured]].
