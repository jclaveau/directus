---
name: project_directus_blackbox_run_and_logs
description: Blackbox runs on every PR touching a non-doc file since 66e5e32501 (2026-08-05) — the Run Blackbox label only forces it and, added after the push, fires a second Check run that cancels the first; how to read its logs (REST job logs lack the containerized vitest output, use the run-logs ZIP).
metadata:
  author: Jean Claveau
  type: project
---

**The `Run Blackbox` label is NOT required on a PR** (since `66e5e32501`, 2026-08-05).
`blackbox-pr.yml` ("Check") has a `Decide` job: runs for a `ci-dialect-*` head, skips on
`Skip Blackbox`, forces on `Run Blackbox` / `Run Blackbox Full` (full = the vendor
matrix), and otherwise runs **whenever a changed file is outside `.agents/`, `docs/`,
`.github/` (except `blackbox*` workflows) or `*.md`** — i.e. any code PR runs it on
`opened`/`synchronize`. Adding the label after the push fires a `labeled` event → a
second `Check` run on the same head whose concurrency **cancels the in-flight one**
(cost ~6 min, seen on PR #497); removing it fires `unlabeled` and does it again. So:
never add the label to a code PR; read the `Decide` step summary when unsure. The
label is only for a docs/memory-only PR that should still exercise the suite.

Trunk pushes run **no** blackbox at all ([[project_directus_trunk_full_vendor_matrix]]).

**Run it on an arbitrary branch's HEAD without merging:** open a PR with that branch as **head** (the
label is only needed if the diff is docs-only) (`gh api -X POST repos/jclaveau/directus/issues/<n>/labels -f "labels[]=Run Blackbox"` —
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

**How to apply:** to verify a fix-forward against blackbox, push to the branch (no label) →
read results per-job via `gh pr view <n> --json statusCheckRollup`; for the failure detail, read the streamed
log around ELIFECYCLE, not the REST job-log body. The redis cache-purge + SAML tests are the high-signal ones.

**Never run blackbox locally as a pre-push gate — push and read CI.** CI fans out 8
shards in parallel (~7min for the lot, and this repo is public so the minutes are
free); locally the same coverage is serial, one shard at a time against one
postgres, after a `dist` build. One local shard costs as much wall clock as the
whole CI run and covers an eighth of it. Jean: *"push without running locally bb
tests, you make us lose a lot of time waiting for local runs"*. Local blackbox
stays useful for **diagnosing a known failure** — reproducing one shard, querying
the seeded DB directly (`docker exec blackbox-postgres-1 psql -U postgres -d
directus …`) to confirm a mechanism. That is the targeted rung of
[[feedback_test_run_ladder]], not a gate. Lint gates DO stay local: seconds to
run, and a CI red on style burns a full cycle.

**Local-run mechanics, when you do reproduce one:**
- Mirror CI's command exactly: `TEST_DB=postgres SHARD_INDEX=N SHARD_COUNT=8 pnpm
  test --project db --shard=N/8`. **Omitting `--project db` bootstraps the `common`
  project's servers too, on the same ports** → `Port 20152 is already in use`, which
  reads like a test failure and is not one.
- A killed/timed-out run leaves `dist/cli start` servers holding those ports; reap
  them before the next run (`ps -eo pid,cmd | grep '\.wt-bb-shards/dist/cli start'`,
  kill by pid). The Bash tool's sandbox **silently swallows the signal** — the
  processes survive and the command still reports success; needs
  `dangerouslyDisableSandbox`. See [[feedback_pgrep_pkill_self_match]].
- Can't run an arbitrary subset: the sequencer validates the whole `before` list and
  dies with `Non-existent test file … in "before" list` if you pass two files.
- Local ≠ CI state. Local timings swung 246s vs 379s for the same seed suite, and a
  local DB carries prior runs' rows. Never quote a local duration as a result.

**The failure step dumps per-request status lines.** `9_Directus server logs (on
failure).txt` in the run-logs ZIP holds the server's own request log
(`GET /fields/test_schema_all_integer/name 403 51ms`). That settles "did the request
404, 403 or return an empty body" in one grep — decisive when a test reports
`undefined` and you are guessing which layer produced it. Grep it before theorising
about the code path.

**Poll the CHILD checks, not the parent.** `Blackbox Tests` (the reusable-workflow
caller) reports `COMPLETED / SKIPPED` while `Blackbox Tests / postgres (shard N)`
are still `IN_PROGRESS` — a waiter filtering on `startsWith("Blackbox")` exits
instantly and reports nothing. Filter on `"Blackbox Tests / "` and additionally
require 8 postgres children to exist, or the poll races the matrix expansion.

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
