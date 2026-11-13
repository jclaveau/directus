---
name: project_directus_bench_workflow_traps
description: Four defects the bench workflow's first real run exposed — duplicate Check names, reserved GITHUB_SHA, always() on cancel, and checkout rejecting a short sha
metadata:
  author: Jean Claveau
  type: project
---

A `workflow_run` trigger only fires from the copy on the **default branch**, so none of
this could be tested before merging. All four were found by the first live run (#441):

- **Two workflows here are named `Check`** — `check.yml` and `blackbox-pr.yml` — and
  `workflows:` matches on the *name*. Gate on
  `github.event.workflow_run.event == 'push'`.
- **`refresh-dialect-ci` rebuilds `ci-dialect-sqlite3` and `ci-dialect-maria` from the
  trunk on every push to it**, so one trunk commit produced three `Check` runs and
  three identical benchmarks. `branches-ignore: [ci-dialect-*, '*-dist']`.
- **`GITHUB_SHA` cannot be overridden.** A step-level `env:` sets it, the run log even
  *displays* the override, and the runner still re-applies its own value — on a
  `workflow_run` that is the default branch's head. `PERF_BASELINE_SHA`, an ordinary
  name, came through fine. Use a non-`GITHUB_*` name.
- **`always()` includes cancellation**, so a cancelled run's reporting step posted
  `failure` on a commit whose bench was fine. Use `!cancelled()`.
- **`actions/checkout` resolves a bare `ref` as a branch then a tag**, never as an
  abbreviated sha — a 10-char sha fails "could not be found". Check out the event's
  ref and resolve an explicit input with `git checkout --detach` after a full fetch.

**How to apply:** a `workflow_run` workflow cannot be validated on a PR; expect to fix
it after merge, and land the fix before the next trunk push. A job log's `env:` block
shows what was *requested*, not what the process got.

**A `workflow_run` bench job checks out the PR head but runs the TRUNK's own
workflow file — if the head predates a new perf test file, the job reports
"the measurement did not finish", not a skip.** A PR #494 branch cut before
`tests/perf/resident.perf.test.ts` landed on trunk (#492) hit exactly this:
vitest found only `startup.perf.test.ts` on the checked-out head and ran that
alone; the trunk workflow still expected a `resident` result and posted the
missing-measurement status, making the PR `UNSTABLE`. Fix is `git merge
origin/<trunk>` into the branch (not a workflow edit) — that both adds the
missing test file and gives the resident bench a real reading of the branch's
own code.

**A `workflow_run` bench run is listed under the TRUNK's sha and branch**, not the PR's:
`gh run list -w bench.yml -b <pr-branch>` never finds it, and a watcher filtering on
`headSha` spins forever (#562, 2026-09-28). Read the PR head's commit statuses
(`gh api repos/<r>/commits/<sha>/statuses`) — `target_url` names the run.
