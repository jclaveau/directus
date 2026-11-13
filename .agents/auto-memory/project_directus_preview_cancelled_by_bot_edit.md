---
name: project_directus_preview_cancelled_by_bot_edit
description: CodeRabbit rewriting a PR description after a push fires an `edited` event that cancels the live admin preview (workflow-level cancel-in-progress) — why the preview dies, the one-line concurrency fix, and the allow rule that lets Claude re-dispatch it
metadata:
  author: Jean Claveau
  type: project
---

Symptom (PR #583, twice): admin preview dead minutes after a push. Cause: CodeRabbit edits the PR body → `pull_request_target` `edited` run → concurrency group is per-PR with `cancel-in-progress: true` at WORKFLOW level → the live preview is cancelled BEFORE the job-level "Re-run admin preview box ticked?" condition runs; the new run then skips.

Fix (not landed; must go via its own PR into `v11.10.1-hhh-dev` because `pull_request_target` reads the workflow from base): give unticked `edited` events their own group so they never cancel:
`group: ${{ github.event.action == 'edited' && !contains(github.event.pull_request.body, '[x] 🔄 Re-run admin preview') && format('preview-admin-noop-{0}', github.run_id) || format('preview-admin-{0}', github.event.pull_request.number || inputs.ref || github.ref) }}`

Re-dispatch: `gh workflow run preview-admin.yml -R jclaveau/directus --ref <branch> -f ref=<branch> -f pr=<N>`. The auto-mode classifier blocks it as a CI bypass; jean added `Bash(gh workflow run preview-admin.yml:*)` to `.claude/settings.local.json` (main tree; `.wt-*` sessions need their own copy) — now dispatches unblocked. Poll the PR body for the new `*.trycloudflare.com` url, hand over `<url>/auto-login`.

**Why:** the preview vanishing after every push looked like a PR problem; it is a bot edit. Complements [[feedback_directus_redispatch_preview_freely]] and [[project_directus_preview_infra]].
**How to apply:** if the preview is dead after a push, check the run's cancel time vs CodeRabbit's body edit before debugging the branch.
