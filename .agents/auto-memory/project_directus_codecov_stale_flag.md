---
name: project_directus_codecov_stale_flag
description: A codecov patch status can be wrong two ways on this repo — a conflicting PR stops pull_request CI entirely, and a carried-forward flag reports a stale number; check both before writing tests.
metadata:
  type: project
---

**Before treating a `codecov/patch` miss as a coverage gap, prove the number is fresh.**
Twice on PR #350 it was not, and both times the code was already fine.

**Failure 1 — a conflicting PR silently stops `pull_request` CI.** `mergeable=false /
state=dirty` means GitHub fires *only* `pull_request_target` workflows. So CLA and
Preview Admin keep running (CI *looks* alive) while Check/Style never fire, and codecov
scores the commit against a **carried-forward** blackbox flag. Symptom: no
`Blackbox Tests /` check-runs on the head sha, yet a `codecov/patch/blackbox` status
exists. Fix: merge the base branch in (merge, not rebase — see
[[feedback_rebase_explodes_merge_consolidates]]) and push; CI resumes.

**Failure 2 — a flag upload is carried forward even when CI is green.** Tell: the
flag's percentage is *byte-identical* to the previous commit's despite new tests, and a
per-file query returns the same misses as before. Fix: re-run the uploading job
(`gh run rerun <run-id> --job <job-id>`), then re-read. On #350 this moved
`codecov/patch` 93.22% → 99.72% with no code change at all.

**How to check, in order:**
- `gh api repos/<o>/<r>/pulls/<n> --jq '.mergeable, .mergeable_state'` — dirty ⇒ failure 1.
- Per-file misses: `https://api.codecov.io/api/v2/github/<o>/repos/<r>/file_report/<url-encoded-path>?sha=<sha>`
  (add `&flag=api` to scope). The v2 `compare/?pullid=N` endpoint gives patch totals;
  its `lines` array is always empty, so per-file is the way in ([[reference_codecov_patch_coverage]]).
- Measure locally with the package's **own** config — a `--coverage.include=` override
  changes what is counted and can flatter the result.
