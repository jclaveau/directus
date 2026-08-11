---
name: feedback_directus_ci_watch_skip_preview
description: When watching CI on this repo, never wait on the Preview Admin run — it never finishes by design; watch Check/Style/CodeQL and report those.
metadata:
  type: feedback
---

**Never wait for `Preview Admin` when watching CI.** Exclude it from every watcher and
from every "is it green?" judgement. Watch `Check` (lint, unit, blackbox), `Style
(changes)` and `CodeQL Analysis`.

**Why:** the preview job is *designed* never to end — it holds `sleep infinity` until its
180-minute hard timeout so the tunnel stays usable. A watcher that waits for "all runs
completed" therefore blocks for hours, and worse, it made me report on the preview while
a blackbox failure sat unread on the same branch. jean: "bb red in ci. never wait for
admin preview when watching ci".

**How to apply:**
- Poll with the preview filtered out, e.g.
  `gh run list --branch <b> --json name,status --jq '[.[] | select(.name != "Preview Admin") | select(.status != "completed")] | length'`.
- The preview link is published into the PR description by the workflow itself — read it
  from there when needed, never by waiting on the run ([[project_directus_preview_infra]]).
- Getting a preview URL is a *separate* errand from watching CI. Never let it delay
  reading the gates ([[feedback_watch_ci_after_push]]).
