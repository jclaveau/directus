---
name: project_directus_bench_measures_trunk
description: a PR's "Bench / *" status DOES measure the PR head — the Bench run's own headSha/headBranch fields show the trunk and are misleading; compare against the trunk tip's status before attributing
metadata:
  author: Jean Claveau
  type: project
---

`.github/workflows/bench.yml` triggers on `workflow_run` of Check. The Bench RUN executes in
the default-branch context, so `gh run list -w Bench` shows `headBranch: v11.10.1-hhh-dev`
and `headSha: <trunk tip>` for every run. That field is NOT what was measured: the jobs
check out `github.event.workflow_run.head_sha` (the pushed branch commit that made Check
run) and post `Bench / *` statuses on that sha.

Corrected 2026-09-25: an earlier version of this note said a PR's red Bench measured the
trunk. Wrong — PR #534's `KB sent per scoped fan fill 80.12 > 78` was the PR's own cost
(trunk `d61427f078` measured 70.96 KB, same gate green). The 2026-09-23 "trunk has been
red for hours" read was the same misattribution.

Attribute a red Bench by comparing statuses, not run fields:

```sh
gh api repos/jclaveau/directus/commits/<pr-head>/statuses \
  --jq '.[]|select(.context=="Bench / cache")|"\(.state) \(.description) \(.target_url)"'
gh api repos/jclaveau/directus/commits/$(git rev-parse origin/v11.10.1-hhh-dev)/statuses \
  --jq '.[]|select(.context=="Bench / cache")|"\(.state) \(.description) \(.target_url)"'
# full gate table: gh run download <run-id> -p 'bench-cache-*' → cache.md
```

Only statuses on push-event Check runs exist (the job gates on `workflow_run.event == 'push'`).
To measure an arbitrary ref, use the `workflow_dispatch` input (`ref`, `baseline`, `reps`).

**Boot-refusal trap (2026-11-02, #667):** `workflow_run` uses the TRUNK's `bench.yml` but boots the PR's
code. A PR that turns an env var into a boot refusal (`EXTENSIONS_PATH`) turns all 4 Bench checks red
("Environment Variable is … Unset it") while the trunk file still sets it. Don't waive: land a tiny
trunk PR dropping the var from `bench.yml` first (#669), merge trunk into the PR, Bench measures it.
Interim proof: `gh workflow run bench.yml --ref <branch>` (own `bench.yml`; set `baseline` to the
merge-base, else it compares the PR to its own previous commit). A rerun reuses the old `bench.yml`.

See [[feedback_ci_attribute_via_base_sha]], [[project_directus_blackbox_flakes]].
