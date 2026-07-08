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
