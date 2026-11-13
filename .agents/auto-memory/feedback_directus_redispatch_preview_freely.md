---
name: feedback_directus_redispatch_preview_freely
description: on this fork, re-dispatch the admin preview after every push without asking — even though it kills the live tunnel
metadata:
  author: Jean Claveau
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

**`--ref` alone boots the WRONG code, silently.** `--ref` only chooses which copy of
the workflow file runs; the code comes from the `ref` **input**, whose default in
`preview-admin.yml` is `v11.10.1-hhh-dev`. Dispatching without `-f ref=<branch>`
gives a green run, a live tunnel and a working admin — of the trunk, with none of the
branch's work in it (2026-09-09, nearly handed over as PR #467's preview; again
2026-09-15 on PR #492 — the run **skipped** outright because `pr` was blank too).
Type the three together as one unit: `--ref X -f ref=X -f pr=N`. Two tells,
both cheap: the job's `Checkout the ref to preview` step logs
`git checkout ... -B v11.10.1-hhh-dev`, and `Publish preview to the PR description`
is **skipped** when `-f pr=<num>` is also missing, so the PR body keeps the previous
run's url. Prove the build by probing a route only the branch serves — 403 means the
route is there, 404 means it is not (that is the whole check; auth is irrelevant).

**Always hand over the `/auto-login` url, never the bare tunnel url.** The preview
ships a `directus-extension-auto-login` endpoint that relays a server-side
`/auth/login` to the browser, so `<url>/auto-login` lands straight in the Data
Studio with no password. jean: _"always provide the autologin link"_ — the bare url
drops him on a login form for credentials he has no reason to hold. The workflow
itself reports it that way (`- **Open (auto-login):** ${URL}/auto-login`, and the
run notice), so quote the same form:

```
https://<tunnel>.trycloudflare.com/auto-login
```

Still probe the bare route for the branch-build proof (403 vs 404); only the url
you hand over changes.

**Any `/app` work ends with a fresh preview link in the reply.** jean:
_"always dump the fresh preview link while available when working on /app"_. When
the change is one he can only judge by looking at it — a panel, a table, a layout —
the deliverable is the code AND a live url to open it in. So after pushing app
changes: dispatch (with `-f ref=` and `-f pr=`), wait for the run's own url, and put
`<url>/auto-login` in the reply rather than leaving him to find it, ask for it, or
open a stale one. If a run is still building, say so and hand it over as soon as it
publishes — a link that is a few minutes late is fine, a stale link is not.

**Read the body back immediately before writing it back (2026-09-10).** The
`edited`-event hazard above is only half of it: the preview publishes its url
*into* the description, so a body fetched before the run's publish step and
PATCHed afterwards silently clobbers the fresh url with the stale one. That is
what happened on #467 — body read at 23:41, preview published at 23:42, PATCH at
23:53, and the block went back to the previous run's tunnel.

Worse, the live url is then **unrecoverable**: `actions/jobs/<id>/logs` is
`BlobNotFound` while the run is in progress, the check-run carries no annotation,
and the tunnel name appears nowhere else. The only way back is another dispatch,
which kills the running tunnel to get a url anyone can read.

So: re-fetch the description in the same command that PATCHes it, splice only the
section being changed, and leave everything between `<!-- admin-preview:start -->`
and `<!-- admin-preview:end -->` exactly as it reads at that moment.

Confirmed the same day: an `edited` run groups on `preview-admin-<pr-number>` and
a dispatch on `preview-admin-<ref>`, so the `edited` run really does **not** cancel
a dispatched preview — it started, skipped, and the dispatch kept running.

A `Run Blackbox` label toggle kills a preview exactly the way a body PATCH does: the push-triggered run is cancelled by per-PR concurrency and the `labeled` event's own run **skips** (the workflow gates on `synchronize`/`opened`), leaving no live preview at all. Measured on PR #456, twice, 2026-09-14 — runs 34896923113 cancelled / 34896942496 skipped. So the order after a push is: push, then any label (rarely needed — blackbox runs on every code PR since 2026-08-05, and a label added after the push cancels its run), then `gh workflow run preview-admin.yml --ref <feature-branch>` **last**.
