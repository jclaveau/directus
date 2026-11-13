---
name: project_directus_ci_cancel_unimpacted_dispatch_bench
description: After a test-only or YAML-only push, cancel the CI runs it cannot affect and dispatch Bench by hand — cancelling the push Check run also stops Bench auto-starting
metadata:
  author: Jean Claveau
  type: project
---

Bench normally starts on its own when the push Check (unit tests) run finishes. Cancelling that run means Bench never starts → dispatch it manually on the head SHA (all suites). If you keep the Check run AND dispatch Bench, the same commit is measured twice → cancel the auto one when it appears.

Jean's pattern (PR #616): after a one-test push he says "cancel the runs not impacted by the new test and run the bench". Keep what feeds the blocker: the push Check run uploads the coverage `codecov/patch` reads; cancel blackbox/acceptance/CodeQL that were green on the prior head and can't be touched by a test file. After a YAML-only commit that changes image sources, KEEP blackbox + acceptance (they pull the images), cancel unit/Lint/Format/CodeQL/Style.

**Why:** free-account 20-job cap, blackbox is 8 shards.
**How to apply:** state what was cancelled and each cancelled run's last green head. "merge when green" = Check + codecov/patch ≥95% + all Bench statuses; never merge on partial data (codecov/patch reads red until api coverage uploads). See [[project_directus_codecov_stale_flag]].
