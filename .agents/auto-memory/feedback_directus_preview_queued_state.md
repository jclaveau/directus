---
name: feedback_directus_preview_queued_state
description: after a push or dispatch that starts a Preview Admin run, run .agents/scripts/preview-queued.sh <pr> so the PR's preview block says "queued" while no runner is free
metadata:
  type: feedback
---

After every push to a `Preview`-labelled PR, and every preview dispatch with `pr=`, run:

```sh
.agents/scripts/preview-queued.sh <pr>
```

When the PR head's Preview Admin run is still waiting for a runner, it rewrites the admin-preview block of the PR body:

```
- **State:** ⏳ queued since 10:27 UTC, no runner yet: 20 jobs waiting on the account, longest 349s · [run 45156321958](…)
```

It does nothing when no run is queued or the job has started. The block takes the queued run's id as its owner, so the run's own "claimed" publish replaces it on boot.

If a minute later the block is still on an older run, run it again: GitHub creates the run a few seconds after the push.

**Why:** PR #758, 2026-11-23. A preview waited ~4 min behind 20 queued CI jobs from my own #680/#758 pushes, while the block still showed the last booted run. jean read that as "the preview env doesn't start" and asked for a queue state; option A (session-written, no CI change) was the go. Nothing inside GHA can write it, because a job doing so queues too.

**How to apply:** the script needs `~/.agents/scripts/gha-contention.sh`. Stub `gh` on PATH to test it without touching a PR. Related: [[project_directus_preview_infra]], [[feedback_directus_ci_watch_skip_preview]].
