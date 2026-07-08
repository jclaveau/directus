---
name: reference_directus_check_workflow_scoping
description: check.yml (Unit/Format/Lint/Style) fires only on prepare/feat** base PRs — NOT hhh-dev; two workflows named "Check"; cancelled≠failed
metadata:
  type: reference
---

CI gotchas that bit hard reviewing PR #205:

- **`check.yml` triggers on `pull_request` to base `v11.10.1-prepare` or `v11.10.1-feat/**` only.** A PR whose BASE is `hhh-dev` (e.g. #205, base `v11.10.1-hhh-dev`) does **NOT** run check.yml → no **Unit Tests / Format / Lint / Stylelint / Style (changes)**. It only gets `blackbox-pr.yml` + CodeQL + CLA. So a stale unit test (the `cacheTags→scopedCacheTags` rename missed `items-cache-tags.test.ts`) was never caught on #205 — only surfaced on #206 (base = a feat branch → check.yml fires). **Verify hhh-dev-based PRs locally** (`pnpm vitest`, `pnpm lint:style:changes <base>`). Workflows load from the BASE branch ([[reference_gha_pull_request_workflow_resolution]]).

- **Two workflows are both `name: Check`** — `blackbox-pr.yml` AND `check.yml`. `gh run watch`/`gh run list --workflow check.yml` disambiguates by FILE, but the display name "Check" is ambiguous; inspecting a run's jobs (`Blackbox Tests / …` vs `Unit Tests`) tells which. Don't assume "Check = unit tests."

- **`cancel-in-progress: true`** (concurrency `check-${{ github.ref }}`): each push **cancels** the prior run. `gh run watch <old-run> --exit-status` then returns **rc=1 with conclusion `cancelled`** — a FALSE failure, not a real one. Don't pile fixes on a "red" that's just a superseded run; re-fetch the run on the CURRENT head sha and watch that.

- **FIX (2026-06-30, commit `704b68bcaa`): dropped the base-branch filters so check.yml runs on EVERY commit** —
  `on: { pull_request: {}, push: {} }` (no `branches:`). `push` events load the workflow from the pushed branch
  itself, so it fires regardless of base; `pull_request` still loads from base (needs the change on the base to
  update there). The filter was inherited from upstream (gated to main/next release branches) and the fork's
  retarget to prepare/feat** predated hhh-dev becoming the work branch → stale. Style (changes) stays `if:
  github.event_name == 'pull_request'` (needs base.sha; skips on push).
- **This gap silently capped codecov.** With check.yml not firing on hhh-dev PRs, the **Unit Tests job never ran →
  unit coverage never uploaded** → codecov/patch saw ONLY the `blackbox` flag (~38%, REST-only) and could not be
  lifted by unit tests no matter how many you wrote. The every-commit fix is what let unit coverage upload and
  codecov/patch go green. See [[reference_codecov_patch_coverage]] / [[project_directus_blackbox_coverage]].

Builds on [[project_directus_fork_integration_branches]] (blackbox-pr.yml is name:Check; gates = build+eslint+stylelint).
