---
name: project_directus_bench_measures_trunk
description: a red "Bench / cache" check on a PR measures the TRUNK sha, not the PR head — bench.yml fires on workflow_run of Check, so it runs in the default-branch context
metadata:
  author: Jean Claveau
  type: project
---

`.github/workflows/bench.yml` triggers on `workflow_run: {workflows: [Check], types: [completed]}`.
A `workflow_run` run executes in the DEFAULT-branch context, so every Bench run reports
`headBranch: v11.10.1-hhh-dev` and `headSha: <trunk tip>` whatever PR made Check run.

Consequence: `gh pr checks <PR>` lists `Bench / cache` and `Bench / startup` among the PR's
checks, but they measured the trunk. A red Bench there is NOT evidence about the branch.

Verify before attributing (2026-09-23, PR #534 — 8 Bench runs that day all on
`514d416386`, the tip of `v11.10.1-hhh-dev`, failing the
`KB sent per scoped fan fill 80.12 > 78` gate since hours before the push):

```sh
gh run list -w Bench -L 12 --json databaseId,headSha,headBranch,conclusion,createdAt \
  --jq '.[] | "\(.databaseId) \(.headSha[0:10]) \(.headBranch) \(.conclusion)"'
git log --oneline -1 origin/v11.10.1-hhh-dev   # same sha → the red is the trunk's
```

To measure an actual ref, use the `workflow_dispatch` input (`ref`, `baseline`, `reps`).

See [[feedback_ci_attribute_via_base_sha]], [[project_directus_blackbox_flakes]].
