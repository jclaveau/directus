---
name: project_directus_autoscale_release_smoke_test
description: Promoted the ad hoc release load test into a vitest smoke spec; Railway's proxy spreads fall-phase traffic evenly, so "victim = idle worker" is unprovable on dev
metadata:
  type: project
---

`planner_2/apps/domain/tests/smoke/pm2-autoscale-release.smoke.spec.ts`
(untracked, not committed), sibling of `pm2-autoscale-load.smoke.spec.ts`. The
test owns every autoscale/supervisor knob it needs rather than relying on
production defaults: `beforeAll` snapshots `GET /utils/autoscale`, then `PATCH
/utils/autoscale` (scale/release thresholds, pacing, pool bounds) and `PATCH
/utils/autoscale/supervisor { killTimeout }` + `POST /utils/autoscale/reload`,
waits for the pool to settle at 1 worker; `afterAll` restores every touched
field to its previous value or `null` and reloads again, even on failure.

Ramp phase drives the argon2 `/utils/hash/generate` shape (admin token) until
the pool grows 1→2. Fall phase runs light probes until it releases 2→1.

**Run 1 failed** (`release did not happen within 180s`): the probe endpoint was
`/server/specs/oas`, and 4 probe loops cost ~35% CPU per worker on dev (smaller
spec file, ~17%/loop) — summed 70%, above the 40% release threshold, so the pool
stayed pinned at 2 forever. Separately, Railway's proxy spread fall-phase
traffic **evenly across both workers**, breaking the "stopped worker == the
youngest/idle one" assumption — that assumption held during the PR-preview bash
load test ([[project_directus_autoscale_release_load_test]]) but not here; a
different environment (dev vs. a pinned PR-preview dist) got a different
proxy load-balancing behavior.

**Rework:** probe swapped to admin `GET
/items/student_course?aggregate[count]=*` (~300 ms PG-bound, always a cache
MISS, ~3% CPU/loop measured). `killTimeout` raised 300→1000 ms — above the
probe's p50 but far under prod's 20 s — with `p50 < killTimeout` kept as its own
control assertion (proves the drain window the release fix depends on was
actually being tested). The victim assertion was **dropped as unprovable behind
the proxy** on dev; the report still records which `nodeId` stopped and the
last-sample per-worker CPU for a human to read, just not as a pass/fail gate.

**Run 2 green** (~29 s test / 52 s wall): grow 1→2 on "average cpu 375% >= 60%"
(737 hashes, 12 s), release 2→1 on "cpu 15% across the 1 worker(s) a release
leaves < 40%" 6 s into the fall phase, 162 probes served, 0 failed, p50 372 /
p90 569 / p99 776 / max 855 ms.

Also confirms [[reference_directus_tests_admin_dev_provisioning]]'s trap from
the test-writer's side: the local `.env.test.secrets` admin login works fine
against dev, but the CI-provisioned Railway `TESTS_ADMIN_PASSWORD` secret 401s
there — so this spec cannot run unattended in CI against dev until that secret
is aligned.

Related: [[project_directus_autoscale_release_load_test]],
[[project_directus_autoscale_in_flight_signal]],
[[project_directus_autoscale_release_judgement]].
