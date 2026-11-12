---
name: project_directus_blackbox_label_restart
description: Any label add/remove on a PR (dist-release, Preview…) restarts all 8 blackbox shards and cancels a running/re-run one via blackbox-<ref> concurrency; fixed by a decide-job guard in blackbox-pr.yml
metadata:
  author: Jean Claveau
  type: project
---

`blackbox-pr.yml` (workflow named "Check") triggers on `labeled`/`unlabeled` so `Run Blackbox`, `Run Blackbox Full`, `Skip Blackbox` take effect, but checked nothing about WHICH label. Adding `dist-release` started a fresh full run, and `blackbox.yml` (`concurrency: blackbox-${{ github.ref }}`, `cancel-in-progress: true`) cancelled the in-flight shard re-run (cancelled at "Start database", before any test).

**Why:** cost a wrong diagnosis: I first blamed my PR-body edit; `edited` is NOT a Check trigger (it only fires the admin preview). The PR timeline (label time vs cancel time) told the truth.

**How to apply:**
- A cancelled re-run right after jean touches a label = the label, not you. Read the PR timeline.
- Fix (in #574, `68777fbbf3`): `decide` job `if:` lets non-label events through and label events only for the 3 Run/Skip labels; a skipped Check run never enters the concurrency group so cancels nothing. Cost: an extra skipped "Check" entry.
- A PR's Check runs the `blackbox-pr.yml` from the PR's OWN branch, so other open PRs get the guard only after merging/rebasing trunk.
- Proof is only on a live PR: add `dist-release` -> Decide skipped; add `Run Blackbox` -> shards start.
- Related: [[project_directus_blackbox_flakes]], [[project_directus_dist_release_label]].
