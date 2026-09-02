---
name: feedback_directus_ci_watch_skip_preview
description: When watching CI on this repo, the Preview Admin run is not a CI check — never wait on it and never mention it in a CI report, whatever state it is in.
metadata:
  type: feedback
---

**`Preview Admin` is not a gate. Filter it out of every watcher, every "is it green?"
judgement, and every CI report you write.** Watch and report `Check` (lint, unit,
blackbox), `Style (changes)` and `CodeQL Analysis`.

**It is meant to run until its worker timeout, or until a newer preview supersedes it.**
Long-running, cancelled, superseded, in_progress for hours, or plain broken — all of
those are its normal range, none of them say anything about the branch. So do not
report it as an exception either: no "the only non-success is preview", no
"mergeStateStatus is UNSTABLE because of the preview". Say the gates are green and
stop — mentioning it at all invites the reader to wonder whether it matters, and it
never does. jean: *"never wait for it when watching ci, do not consider it in your CI
reports despite if it doesn't work as expected"*.

**Why:** the job holds `sleep infinity` to its 180-minute hard timeout so the tunnel
stays usable. A watcher that waits for "all runs completed" blocks for hours — and once
it made me report on the preview while a blackbox failure sat unread on the same branch.
jean: "bb red in ci. never wait for admin preview when watching ci".

**How to apply:**
- Poll with the preview filtered out, e.g.
  `gh run list --branch <b> --json name,status --jq '[.[] | select(.name != "Preview Admin") | select(.status != "completed")] | length'`.
- The preview link is published into the PR description by the workflow itself — read it
  from there when needed, never by waiting on the run ([[project_directus_preview_infra]]).
- Getting a preview URL is a *separate* errand from watching CI. Never let it delay
  reading the gates ([[feedback_watch_ci_after_push]]).
- Counting check-runs, subtract it before you state a total: "80/80 success" beats
  "80 success, 1 in_progress (preview)".
