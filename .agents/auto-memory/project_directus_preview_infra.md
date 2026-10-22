---
name: project_directus_preview_infra
description: jclaveau/directus preview environments — Preview Admin (runner-hosted ephemeral, cloudflared tunnel) vs the dropped Northflank Preview Deployment webhook; both gated on the `Preview` label; default branch is v11.10.1-hhh-dev since 2026-07-27 (was pr-controle)
metadata:
  author: Jean Claveau
  type: project
---

Two preview mechanisms on the fork, both keyed off the **`Preview`** GitHub label. **Default branch = `v11.10.1-hhh-dev`
since 2026-07-27** (was `pr-controle`, now retired — [[directus-fork-integration-branches]]); `pull_request_target`
resolves its workflow from the default, i.e. hhh-dev now.

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

**Autoscaler in the preview (added for PR #467, `4fccccc6d2`):** by default the
preview only started the `directus` pm2 app, so any page reading autoscale state
(Settings → Processes) showed nothing — no process on the bus reported
`autoscale`. Fixed by starting a second pm2 app, `directus autoscale`, scaling the
first, with preview-only pacing baked into the job env (`SAMPLE_WINDOW=3`, min 2 /
max 6 workers, add-cooldown 10s / release-cooldown 30s, warmup 15s) so a lever
pulled in the GUI has a visible effect inside the preview's short life. Verify via
`GET /utils/processes`: a `pm 3 autoscale=YES` entry alongside the `directus`
workers, `config.appName: 'directus'`.

**Preview Deployment** (`preview-webhook.yml`) — Northflank-hosted, PERSISTENT. **DROPPED on pr-controle this session.**
- Was a `pull_request_target: [labeled, synchronize]` job that fire-and-forget POSTed to
  `webhooks.northflank.com/previews/${PREVIEW_TOKEN}` with `pullRequestId`/`repoUrl`/`branch`; Northflank built a hosted
  env. URL lived in the **Northflank dashboard** — never returned to GitHub (no deployment/comment).

**Two CI traps in `preview-admin.yml`, diagnosed and fixed 2026-09-10 (fix
written, uncommitted, sitting in `.wt-autoscaler` — belongs on its own branch
off `v11.10.1-hhh-dev`, not inside a feature PR, because `pull_request_target`
resolves the workflow from the base branch so the fix is inert anywhere else):**

1. **A PR-body `edited` event kills the live preview even though its own `if:`
   gate would skip it.** GitHub cancels a concurrency group's in-progress run
   the moment the new run is *queued* — before any job-level `if` runs. So an
   `edited` run that will do nothing still kills the `synchronize` preview
   sharing its group (`preview-admin-<pr-number>`). Fix: give an `edited`
   event the job won't act on its own group suffix (`-inert`), computed from
   the same condition the job's `if:` already checks (Preview label present +
   the re-run checkbox ticked) — a *ticked* re-run still shares the main
   group and replaces the live preview, as intended. Related finding: a PATCH
   made with `GITHUB_TOKEN` (the bot's own body edits) does **not** spawn an
   `edited` run — only a human/`gh`-token edit does — so the workflow's own
   URL-publish write was never the problem; once this lands, the surrounding
   "re-fetch the body in the same command that PATCHes it" workaround stops
   being load-bearing.
2. **A `workflow_dispatch` preview publishes its URL nowhere reachable.** The
   "Publish preview to the PR description" step is gated on
   `github.event.pull_request.number || inputs.pr`; a dispatch with `pr`
   blank leaves the URL only in the run Summary, written by the streaming
   step when the job *ends* — by which point the tunnel is already dead. Fix:
   a new `Resolve the PR to publish into` step right after the tunnel starts,
   resolving `gh pr list --head <dispatched ref> --state open` when `pr` is
   blank, so a manual run on a PR's head branch still publishes into that
   PR's description (and gets a real SHA in the header instead of a branch
   name).

**Propagation — CORRECTED empirically (2026-07-10).** The old caveat here claimed `pull_request_target` resolves the
wf from the PR's BASE (hhh-dev), so pr-controle edits wouldn't reach hhh-dev-based PRs. **This is WRONG for
preview-admin:** the wf exists ONLY on `pr-controle` (absent on `v11.10.1-hhh-dev`), yet it fired as
`pull_request_target` AND commented on #227 (base hhh-dev) repeatedly. So `pull_request_target` used the **default
branch** (pr-controle) copy, not the PR base. **Consequence: patch `pr-controle` only — no hhh-dev propagation needed**
for the comment/button; toggle the `Preview` label on any PR to pick up the latest pr-controle version. (Mechanism not
fully proven — could be a default-branch fallback when base lacks the file; recorded as empirical. Contrast the
`pull_request` / `uses:./` cases in [[reference_gha_pull_request_workflow_resolution]].)
