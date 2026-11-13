---
name: project_directus_test_profile_window_proposal
description: PROPOSED (not built) start/stop in-process profiler window for blackbox/domain tests — which node metrics are assertable, what a profile cannot see (DB planning), CI single-process facts
metadata:
  author: Jean Claveau
  type: project
---

Proposal only (2026-11-13), jean's direction: test helpers that start/stop a profile; overlapping requests are fine (they mimic reality).

- A Node CPU profile is blind to Postgres planning: node sits idle on the socket, the profile shows idle. Signal = wall ms − CPU ms.
- In-process `node:inspector` Profiler + `process.cpuUsage()` + `monitorEventLoopDelay` + `eventLoopUtilization` + heap delta; no restart, no clean exit (`--cpu-prof` only writes on clean exit, unreadable mid-suite).
- Proposed fork surface: admin-only `POST /utils/profile/start|stop`, env-flag gated (test env only). Reliable only with ONE process; pm2 cluster reaches one worker.
- Assertions: loose budgets (~3x measured), never equality; the one CI-gating timing check = same-run ratio (CPU at big size ≤ 1.5× CPU at small size) because runner speed cancels. Never assert a function name in a top-N. Profiles = artifact only.
- Deterministic alternative preferred first: add `maxStatementBindParams` to the query-audit tally (the old 1,688-branch `_or` would have failed it).
- Postgres locks = separate `pg_stat_activity wait_event_type='Lock'` probe, not a Node metric.

Filed 2026-11-13 as fork #740 (profile window) + #741 (maxStatementBindParams), consumer-side issue in the consumer repo; out of scope for the registration-scaling PR.

**Why:** records the design so a clean session does not redo the metric survey. **How to apply:** build only on jean's go; start with cheap metrics + bind-param tally.
