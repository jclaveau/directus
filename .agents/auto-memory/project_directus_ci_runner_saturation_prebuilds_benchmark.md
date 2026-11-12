---
name: project_directus_ci_runner_saturation_prebuilds_benchmark
description: Directus CI jobs stuck queued for minutes = jclaveau/ci-prebuilds nightly benchmark-playwright.yml (142 jobs, no max-parallel) eating the account's 20 free runner slots; how to diagnose
metadata:
  author: Jean Claveau
  type: project
---

Queued-for-minutes CI in `jclaveau/directus` (normal start 2-3 s) is account-wide runner starvation, not this repo.

**Cause (measured 2026-10-16):** `jclaveau/ci-prebuilds` `benchmark-playwright.yml` (cron `0 3 * * *`, GitHub fires it late: 07:57-10:24 UTC over 8 days = jean's working hours) spawns 142 `ubuntu-latest` jobs, matrices without `max-parallel` (lines 113, 200, 284). Free plan = 20 concurrent jobs across all public repos; benchmark holds them 17-58 min.

**Fix landed 2026-10-16, ci-prebuilds main 3f940ea:** a scheduled run whose inputs match the last green run skips (1 job, not 142); otherwise `max-parallel: 4` on each of the 3 CONCURRENT matrix jobs → 12 slots peak, 8 free. Per-job 12 (first proposal) was wrong: max-parallel is per job, 3 jobs run side by side → 36. First real run = next 03:00 cron.

**Why:** same-repo peak was 18 jobs (<20) and no shared concurrency group, GitHub status green, no self-hosted runners: that ruled out in-repo causes.

**How to apply:** before blaming the PR, list queued+running runs across ALL jclaveau repos, measure created→started latency, look for a 100+ job schedule run. Related: [[project_directus_bb_alpine_prebuilds_verdict]].
