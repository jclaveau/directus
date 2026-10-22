---
name: project_planner_deploy_pr_bundling
description: Planner's deploy PR (develop→main) ships every fork PR merged since the last deploy, not just the one you meant to ship
metadata:
  author: Jean Claveau
  type: project
---

The planner has no per-change PR habit on `develop` — "push it" means commits land
directly on `develop`, no PR. Shipping to prod is a separate, later step: a `deploy:
<summary>` PR from `develop` → `main` (no PR template exists for it). Merging that PR
*is* the prod deploy — it moves prod's fork pin.

**Why this matters:** prod's fork pin is sticky and can go stale for a while (last moved
2026-09-02 as of this writing). When you finally open the deploy PR, it carries every
fork PR merged to the planner's tracked branch since that stale pin — not just the
change you're currently working on. Opening PR #749 (`deploy: cheaper boot and extension
loading, and a processes report that shows CPU`) surfaced **twelve** fork PRs riding
along (#398, #427, #429, #434, #435, #439, #440, #441, #444, #445, #447, #448), most of
them unrelated dev-only/tooling changes, but four (#434/#435/#440/#444/#445) with real
runtime reach on the boot path prod's 32-worker pool exercises constantly.

**How to apply:** before merging (= deploying) a "deploy: ..." PR, diff `main...develop`
fork-pin history to enumerate what's actually shipping, not just the commits you
authored this session — the payload is always bigger than the last few commits. Call
this out explicitly in the PR body (as done for #749) so the merger knows the true
blast radius.
