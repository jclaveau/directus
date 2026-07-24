---
name: project_directus_blackbox_run_and_logs
description: How to trigger the label-gated blackbox suite on a branch HEAD (compare-PR + Run Blackbox label) and why its REST job logs are unreadable (containerized vitest output) — read the streamed section before ELIFECYCLE instead.
metadata:
  type: project
---

The blackbox suite (`tests/blackbox`, 7 jobs: common + 6 DBs) is **label-gated** on PRs: `blackbox-pr.yml`
("Check") runs only when the PR carries the `Run Blackbox` label. It also runs on push to `main` only —
**not** the v11.10.1 line until #187 added `v11.10.1-prepare` to `blackbox.yml`'s push triggers.

**Run it on an arbitrary branch's HEAD without merging:** open a PR with that branch as **head** + add the
`Run Blackbox` label (`gh api -X POST repos/jclaveau/directus/issues/<n>/labels -f "labels[]=Run Blackbox"` —
`gh pr edit --add-label` 500s on this classic-Projects repo, [[gh-issue-view-quirk]]). `blackbox-pr.yml`
(the label gate) loads from the **base**, but the reusable `blackbox.yml` it calls via `uses: ./` loads from
the **PR head/merge ref** — so the head's suite runs regardless of base. Used a PR of `v11.10.1-prepare` vs
the upstream **`v11.10.1` tag** (pushed as branch `upstream-v11.10.1`) as a clean baseline — 87-file fork diff,
full blackbox green, proving a SAML failure was the dep not the line.

**Its logs are unreadable via REST.** The directus server + vitest run inside docker-compose containers, so the
job log fetched via `…/actions/jobs/<id>/logs` contains only the runner's checkout/setup/cleanup — the actual
vitest failure isn't there (greps for the test name return nothing). The error IS in the **streamed** log: the
server-startup throw / vitest summary sits just before `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` + `ELIFECYCLE`. Read
that window (`sed -n` around the ELIFECYCLE line) after stripping ANSI. The full run-log zip needs the run id,
which `gh run list --branch <b> --workflow Blackbox` often returns empty for. See [[feedback_gh_job_logs_via_curl]].

**How to apply:** to verify a fix-forward against blackbox, push to the branch + ensure `Run Blackbox` label →
read results per-job via `gh pr view <n> --json statusCheckRollup`; for the failure detail, read the streamed
log around ELIFECYCLE, not the REST job-log body. The redis cache-purge + SAML tests are the high-signal ones.

**BEST failure-detail method = the RUN-logs ZIP, not per-job.** The per-JOB endpoint
(`/actions/jobs/<id>/logs`) returns ONLY the runner's setup/cleanup for a completed bb job — grepping the test
name finds NOTHING (don't conclude "no failure"). The RUN-logs ZIP has the full per-shard vitest output:
`curl -sL -H "Authorization: token $(gh auth token)" .../actions/runs/<run-id>/logs -o rl.zip` →
`unzip -l` → read `Blackbox Tests _ <vendor> (shard N)/8_Run tests.txt` (the vitest summary + `Failed Tests`
block + the exact test file:name are there). ZIP is empty while the run is in-progress — wait for completion.
**Triage flake-vs-real by STEP:** `gh api repos/jclaveau/directus/actions/jobs/<job-id> -q '.steps[]|"\(.number)\t\(.conclusion)\t\(.name)"'` — failure in **step 8 "Run tests"** = a real test failure (read its ZIP file);
failure in an earlier setup step (Start database/services) = infra flake → rerun. bb runs inside the `Check`
workflow (workflowName=`Check`); find its run id via `gh run list --branch <b> --json databaseId,workflowName,headSha` filtered by head sha; find the failing job id via `gh run view <run-id> --json jobs`.
push+PR double-run means two `Check` runs per head — the one WITH the bb jobs is the `pull_request` one.
