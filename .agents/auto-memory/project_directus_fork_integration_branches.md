---
name: directus-fork-integration-branches
description:
  jclaveau/directus branch model — main = upstream + thin overlay, hhh-main = derived integration branch auto-composed
  from open PRs by compose-hhh-main.yml; plus blackbox/e2e label-gating + mssql fork-runner saturation
metadata:
  type: project
---

The fork `jclaveau/directus` runs a soft-fork integration setup (built 2026-06-10).

## Branch model

```
main      = upstream directus/directus + ONE overlay: .github/workflows/compose-hhh-main.yml
            (+ a temp blackbox.yml mssql-matrix edit). default branch. sync = `git merge upstream/main`.
feature/* = individual proposals PR'd INTO main, titled `upstream-draft: …` (e.g. #46 batch insert, #48 #35 drop-index-if-exists).
hhh-main  = DERIVED = main + merge(open non-draft PRs into main TITLED `upstream-draft: `). force-pushed each run. never commit to it.
```

`hhh-main` = "main as it would be if our PRs were accepted." Never authored — `compose-hhh-main.yml` rebuilds it.

## Patching the overlay workflows — commit straight to main

The fork-internal overlay files (`compose-hhh-main.yml`, the temp `blackbox.yml` matrix edit) are **ours**, not upstream
proposals. Fix them with a **direct commit to `main`** — do NOT branch + PR. User: _"you don't need PR to patch your wf
in main, commit directly."_

- A PR for the overlay is pure overhead: it can't even self-validate — `compose-hhh-main.yml` is a direct `pull_request`
  workflow, so a PR runs the **base** (old) copy, never the patched one (see [[gha-pull-request-workflow-resolution]]).
  The fix only proves out post-merge regardless.
- This is the carve-out to [[feedback_branch_large_ci_refactors]]: branch+PR is for upstream-bound `feature/*` and big
  matrix re-architectures; a focused fix to the fork's own overlay is direct-to-main.
- Push over SSH (`git@github.com:…`) so the workflow-file change needs no `workflow` token scope.

## Divergences from upstream on main (keep-ours on sync)

`main` is meant to be upstream + the ONE overlay (`compose-hhh-main.yml`). A small number of **edits to upstream-owned
files** also live on main and must be **kept on every `git merge upstream/main`** — never "reconciled" back to the
upstream form:

- **`.github/workflows/check.yml` — Codecov auth** (commit `3f6f600683`, 2026-06-11). Added `if: always()` +
  `env: CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}` to the "Upload coverage to Codecov" step. **Why the fork needs
  it:** tokenless Codecov upload only works for the canonical `directus/directus` slug; the fork uploads under
  `jclaveau/directus` (a separate Codecov project) so it needs an explicit token — which Codecov's own "Using GitHub
  Actions" setup wizard issued and told us to add. Kept the per-folder-flag CLI loop (NOT `codecov-action@v5`, which
  does a single upload and would regress the `codecov.yaml` flag carryforward). `CODECOV_TOKEN` secret set on the repo
  2026-06-11. **On sync:** if upstream rewrites that step, resolve the one conflict hunk **keep-ours** (don't drop the
  token/`if: always()`). Low odds — it's 3 isolated lines in a stable step. Same workflow-file class as
  [[feedback_gh_pr_merge_workflow_scope]]; push over SSH.

## compose-hhh-main.yml

Triggers: `pull_request` (base main) + `workflow_dispatch` + daily cron. Steps: merge upstream→main + push → discover
open non-draft PRs into main whose title starts with `upstream-draft: ` (`gh pr list ... select(.title|startswith)`) →
`checkout -B hhh-main main` + merge each via `refs/pull/N/head` (skip-on-conflict, report skipped in a tracking issue) →
`prepare` (full build) → `pnpm --filter @directus/api test` → force-push hhh-main only if green.

**Why overlay-on-main, not byte-pure main:** byte-pure main forces the default branch off main (schedule fires only from
default's workflow copy) AND kills the `pull_request` instant-trigger. One overlay file avoids all of it; the overlay
doesn't pollute feature-PR diffs (already in base). See [[gha-pull-request-workflow-resolution]].

**Recurring sync-step failure — upstream workflow-file changes:** the in-workflow
`git merge upstream/main + git push origin main` step pushes over **HTTPS with the default `GITHUB_TOKEN`**, which has
no `workflow` scope. Whenever upstream's merge touches a `.github/workflows/*` file (e.g. `prepare-release.yml`), the
push is rejected:
`! [remote rejected] main -> main (refusing to allow a GitHub App to create or update workflow ... without workflows permission)`
→ compose run fails. This is **integration-overlay infra, NOT any feature PR's gate** — a red `compose` check on a
feature PR with this signature is not that PR's fault. Fix options (not yet applied): add `permissions: contents: write`
won't help (GitHub Apps can't push workflow files at all); use a PAT/deploy-key with `workflow` scope for the sync push,
or `actions/checkout` over SSH like the overlay edits do (line above). Same root mechanism as
[[feedback_gh_pr_merge_workflow_scope]] (workflow-file push needs workflow scope), here in the auto-sync push.

## Fork CI quirks

- **blackbox + e2e are label-gated**: `blackbox-pr.yml` runs Blackbox only with the `Run Blackbox` label, E2E only with
  `Run E2E`, on `synchronize`/`labeled`. A PR runs NEITHER by default — only Check/Changeset/CLA/agent-scan. Add the
  label via REST (`gh api -X POST .../issues/<N>/labels`), not `gh pr edit` ([[gh-issue-view-quirk]]).
- **`blackbox-pr.yml` is `name: Check`** — so in `gh run list` the Blackbox run shows as **"Check"**, not "Blackbox". A
  push spawns TWO "Check" runs: the real one (Lint/Unit/Format/Stylelint jobs) AND this one (`Blackbox Tests / <db>`
  jobs, via `uses: ./.github/workflows/blackbox.yml`). Identify by listing each run's jobs, not by name.
- **CI gates = build + eslint + stylelint only** (`build` recursive = tsdown/esbuild, no full typecheck; `lint`=eslint;
  `lint:style`=stylelint). There is **no `tsc`/`tsgo` gate** — running `tsgo --noEmit` floods pre-existing baseline
  errors (schemas.ts, snapshots.ts, ai/chat, even untouched dialect files) the repo doesn't enforce. Don't chase tsgo
  noise; verify a change with build + eslint + the targeted vitest run.
- **mssql shard melts down on the fork runner**: the full parallel `db` suite saturates the mssql/tedious container —
  100+ tests time out at 15s en masse (json-filter 103, no-relation 35, batch-insert collateral) and the shard cancels.
  Dropped mssql from `blackbox.yml`'s matrix. **pg + sqlite are the healthy batch-insert signal** (both green, ~1s;
  mssql inconclusive, not a logic bug).

Related: [[directus-db-clients-and-returning-support]].
