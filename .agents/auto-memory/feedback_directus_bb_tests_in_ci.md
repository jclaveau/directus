---
name: feedback_directus_bb_tests_in_ci
description: Never run the blackbox suite locally on this repo — it is slower than CI; push and run it in GitHub Actions, looping on the run until it is green.
metadata:
  author: Jean Claveau
  type: feedback
---

**Do not run `pnpm test:blackbox` locally.** Run the blackbox suite in CI and loop on the
run until green. Told twice — the second time after I had already been asked to stop.

**Why:** locally it is *slower* than CI, not faster. Every local run pays a full
`rimraf dist` + `pnpm --filter directus deploy --prod dist` before vitest even starts,
then boots a Directus server per env variant per vendor on one machine. CI shards the
same work 8 ways across parallel runners, and the runners are doing it anyway. The local
run also mutates jean's own `blackbox-*` docker stack (it bootstraps and re-seeds the
shared postgres), so it has a side effect on his environment that CI does not.

**How to apply:**
- Write the test and prove the red/green claim at the **unit** level where the fix has a
  unit seam — but prove it on CI, not locally: [[feedback_directus_ci_only_test_runs]].
- For the blackbox layer: commit, push, open the PR, add the `Run Blackbox` label, and read
  results from the run — mechanics in [[project_directus_blackbox_run_and_logs]].
- "Ensure red then make it green" over blackbox = two CI runs on the branch (one with the
  fix reverted, one with it applied), not two local runs. Use `ScheduleWakeup` / a monitor
  to loop on the run rather than polling — see [[feedback_wakeup_for_long_ci]].
- SUPERSEDED 2026-09-23: the exception for a local targeted `vitest` is withdrawn — every
  layer now runs in CI, see [[feedback_directus_ci_only_test_runs]].
