---
name: project_directus_preview_infra
description: jclaveau/directus preview environments — Preview Admin (runner-hosted ephemeral, cloudflared tunnel) vs the dropped Northflank Preview Deployment webhook; both gated on the `Preview` label; default branch is pr-controle
metadata:
  type: project
---

Two preview mechanisms on the fork, both keyed off the **`Preview`** GitHub label. Default branch = **`pr-controle`**
(not main/hhh-dev). Active feature PRs base on `v11.10.1-hhh-dev`.

**Preview Admin** (`.github/workflows/preview-admin.yml`) — runner-hosted, EPHEMERAL.
- Boot env carries `CACHE_STATS_ENABLED='true'` (added for #227) — cache-stats is opt-in-off by default, so the Settings→Cache page + its runtime toggle only show live data with this set. [[project_directus_cache_admin_page]]
- Boots the ref's Directus (postgres + redis service containers, `CACHE_AUTO_PURGE_MODE=scoped`) on the GitHub runner,
  seeds `items → sub_items` (both with `user_created`), exposes the admin UI via an OUTBOUND **cloudflared quick
  tunnel** (`*.trycloudflare.com`, tokenless — runners take no ingress), prints a random admin password to the run
  summary, auto-shuts-down after `idle_minutes` (default 15) of no Directus-log growth.
- Triggers: `workflow_dispatch` (manual, `ref` input, id 309892117) + (as of this session) `pull_request_target:
  [labeled, synchronize]` gated on the `Preview` label — every push to a Preview-labeled PR boots a fresh preview of
  the PR head sha. Per-PR `concurrency` (`cancel-in-progress`) → one live preview per PR.
- **The tunnel URL is only on the run Summary page** — not API-fetchable mid-run (it's in `$GITHUB_ENV` + a streaming
  idle-watcher step). See [[gh-job-logs-via-curl]].
- **The `preview` check stays `pending` by DESIGN — never wait for it as a merge gate.** Its last step
  ("Stream logs + publish URL + idle shutdown") is a long-running keepalive that only completes on idle-shutdown
  (~15min), so the check never flips green. On a fully-tested PR this shows `mergeStateStatus=UNSTABLE` (not `BLOCKED`)
  → `preview` is NOT a required check → merge past it. Bit my #227 CI-watch loop: I nearly kept waiting for `preview`
  to go green after all 80 real checks + codecov 95.67% were green. Merge criteria = the REQUIRED checks (blackbox
  shards, Unit, Lint, Stylelint, Style(changes), CodeQL, codecov/patch); a lone `pending`/`UNSTABLE` from the preview
  keepalive is expected. Same UNSTABLE-vs-BLOCKED test as the codecov partial-upload rollup [[reference_codecov_patch_coverage]].
- **Posts a PR comment** (PR #228 + #230, merged to pr-controle) on `pull_request_target` runs: URL `/admin`,
  `admin@example.com` + password, seeded collections, idle note, and a **🔄 re-run link** (the current run's URL —
  one click on "Re-run all jobs" boots a fresh instance + a new comment). `permissions: pull-requests: write` +
  `gh pr comment --body-file`. Backticks escaped `\`` so they stay literal markdown (not shell command-subst).
  `workflow_dispatch` runs SKIP the comment (no PR context) — only the Summary. **Re-trigger by toggling the
  `Preview` label** (remove+re-add via `gh api …/labels`) → fires the `labeled` event. GH comments have no native
  buttons — a "button" is a markdown link.
- **Creds are WORLD-VISIBLE**: the fork is PUBLIC, so the password in the comment is public for the preview's ~15min
  life (GH caches comment history). Accepted by jean (throwaway instance, random pw, no real data). Safer fallback if
  ever needed: pw in the members-only Summary, only the link in the comment.

**Preview Deployment** (`preview-webhook.yml`) — Northflank-hosted, PERSISTENT. **DROPPED on pr-controle this session.**
- Was a `pull_request_target: [labeled, synchronize]` job that fire-and-forget POSTed to
  `webhooks.northflank.com/previews/${PREVIEW_TOKEN}` with `pullRequestId`/`repoUrl`/`branch`; Northflank built a hosted
  env. URL lived in the **Northflank dashboard** — never returned to GitHub (no deployment/comment).

**Propagation — CORRECTED empirically (2026-07-10).** The old caveat here claimed `pull_request_target` resolves the
wf from the PR's BASE (hhh-dev), so pr-controle edits wouldn't reach hhh-dev-based PRs. **This is WRONG for
preview-admin:** the wf exists ONLY on `pr-controle` (absent on `v11.10.1-hhh-dev`), yet it fired as
`pull_request_target` AND commented on #227 (base hhh-dev) repeatedly. So `pull_request_target` used the **default
branch** (pr-controle) copy, not the PR base. **Consequence: patch `pr-controle` only — no hhh-dev propagation needed**
for the comment/button; toggle the `Preview` label on any PR to pick up the latest pr-controle version. (Mechanism not
fully proven — could be a default-branch fallback when base lacks the file; recorded as empirical. Contrast the
`pull_request` / `uses:./` cases in [[reference_gha_pull_request_workflow_resolution]].)
