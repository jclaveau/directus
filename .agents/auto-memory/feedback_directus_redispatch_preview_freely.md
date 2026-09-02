---
name: feedback_directus_redispatch_preview_freely
description: on this fork, re-dispatch the admin preview after every push without asking — even though it kills the live tunnel
metadata:
  type: feedback
---

After pushing a UI change that jean is reviewing in the admin preview, **re-dispatch
`preview-admin.yml` immediately, without asking** — do not stop to confirm that it
will cancel the running preview.

```
gh workflow run preview-admin.yml -R jclaveau/directus \
  --ref <feature-branch> -f ref=<feature-branch> -f pr=<num>
```

**Why:** jean, after I asked whether to re-dispatch: _"go, next time redispatch without
asking"_. The concurrency group (`preview-admin-<ref>`, `cancel-in-progress: true`)
means a new run kills the live one — that cancellation is expected and wanted, not a
side effect worth a confirmation. A preview showing stale code is worth less than the
tunnel he currently has open.

**How to apply:**
- Dispatch on the **feature branch's own ref** — `pull_request_target` resolves the
  workflow from the BASE branch, so a PR-event preview runs the base copy and misses
  any change to `preview-admin.yml` itself.
- Don't PATCH the PR description right after a push while a preview is live: the
  `edited` event creates a run that cancels the in-flight one, and it then skips
  (its `if:` gate needs the re-run checkbox ticked). That is how I lost a preview.
- Wait for the run's OWN url before reporting it — the block in the PR body is
  labelled with the dispatched **ref** (not a 40-char sha), and a stale url from a
  cancelled run sits there until the new one publishes.

Related: [[feedback_never_pause_unless_blocked]], [[project_directus_pgbouncer_admin_console]].

**A dispatch does NOT cancel the PR-event preview.** The concurrency group is
`preview-admin-${{ github.event.pull_request.number || inputs.ref || github.ref }}`
→ a `pull_request_target` run groups on `preview-admin-<pr-number>`, a dispatch on
`preview-admin-<ref>`. Different groups, so both run at once and both publish into
the same block of the PR description (last writer wins) — while serving DIFFERENT
code, since the PR-event one loads the workflow from the base branch. Always prove
which run owns a url before handing it over ([[feedback_wait_on_producer_not_shared_sink]]).
