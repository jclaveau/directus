---
name: project_directus_dist_release_label
description: The `dist-release` PR label builds a `<branch>-dist` for a PR head via release-fork.yml, what the PR path needed that the push path did not, and the race it exposed
metadata:
  type: project
---

`release-fork.yml` (on the DEFAULT branch `v11.10.1-hhh-dev`, which is also feature PRs'
base) builds a committed `<branch>-dist` so a consumer can install a branch. Since
2026-08-31 a PR labelled **`dist-release`** gets the same treatment for its own head,
rebuilt on every push while the label is on.

Three things the PR path needed that the push path did not:

- checkout takes `github.event.pull_request.head.sha` — a `pull_request` checkout lands
  on the MERGE commit, and `<branch>-dist` is supposed to mean the branch;
- the dist branch is named from `head.ref`, not `git rev-parse --abbrev-ref`, which reads
  `HEAD` once that checkout leaves us detached;
- the job is gated to same-repo PRs: a fork's `pull_request` token is read-only and the
  final push would fail after doing the whole build.

**The race it exposed:** the branch is rebuilt by `push --delete` then recreate, so two
runs for one branch fight — the older recreates what the newer pushed and the newer is
rejected with *"the remote contains work that you do not have"*. Rare on release lines
(one push at a time), routine once `synchronize` fires per push. Fixed with a
`concurrency` group keyed on the branch, `cancel-in-progress` only for `pull_request`
(a release-line build is one somebody asked for and should queue, not lose its dist).

**Gotcha that cost a round:** labelling did nothing at first. A push to the BASE does not
recompute a PR's merge ref, so #402's workflow set predated the new trigger; toggling the
label off/on did not help either. Only a **head push** refreshes it.

Related: [[reference_gha_pull_request_workflow_resolution]], [[feedback_verify_moving_tag_payload]].
