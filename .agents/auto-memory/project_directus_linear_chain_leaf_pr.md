---
name: project_directus_linear_chain_leaf_pr
description:
  The v11.10.1 feat stack moved from a compose-tree to a single linear PR chain; hhh-dev is now maintained by merging
  the leaf PR, not by recomposing. compose-hhh-v11 cron is disabled.
metadata:
  type: project
---

The v11.10.1 feature set is now a **single linear chain** (was a compose tree):

```
v11.10.1-prepare → #115 build-tsdown → #114 extensions-rolldown → #190 blackbox-coverage
                 → #98 → #99 → … → #110
```

- **Linearized deliberately** (2026-06): #98 root rebased onto #190, #114 inserted between #115 and #190.
  The runtime chain inherits tsdown+blackbox so its standalone CI gets bb-coverage (resolves the old
  "can't reach the tsc stack" constraint in [[project_directus_blackbox_coverage]]).
- **hhh-dev = the integration target**, reset to **`v11.10.1-prepare` tip** (NOT the upstream tag — the chain
  is prepare-based and prepare carries the CI layer the feats need; a bare-tag base would strip it). The leaf
  branch (batch-insert) is strictly ahead of prepare → **PR #192 (leaf → hhh-dev)** is a clean fast-forward =
  exactly the feature commits. That single PR replaces compose as the integration mechanism.
- **compose-hhh-v11 cron DISABLED** (workflow_dispatch-only kept as manual fallback). A cron rebuild would
  force-push over the PR-merge model. Lives on `pr-controle`. Supersedes the tree model in
  [[project_directus_compose_copy_stack]] / [[project_directus_compose_stack_order_rubric]] for the v11 line.

**Update (2026-06-25):** leaf moved past batch-insert — `#198 catalog-factorize` stacked on top (drop rolldown-superseded catalog entries). Integration is now **#199 (catalog-factorize → hhh-dev)**; #192 was CLOSED (GitHub can't retarget a PR head, so recreate from the new leaf). The merge was a **SQUASH** (not the clean FF the model assumed — hhh-dev had diverged from prepare), so hhh-dev = one squash commit `399ce02e22`; the intermediate PRs (#114/#190/#98-#110/#198) stay "open" (their individual commits aren't on hhh-dev) and should be closed as superseded.

**release-fork dist build:** `.github/workflows/release-fork.yml` (`on: push: branches: ['*-hhh-dev']`) builds + commits a `<branch>-dist` per release line (prebuilt dist for catalog: planner installs). It was LOST when prepare branched off the upstream tag → had to be re-added to BOTH prepare (dormant — prepare≠`*-hhh-dev`) and v11.10.1-hhh-dev (fires). Filter keeps it off prepare/feature branches; the `-dist` branch doesn't match → no re-trigger loop. Uses `./.github/actions/prepare` (`pnpm run build` via tsdown). First run on hhh-dev: SUCCESS, no token-403.

**Update (2026-06-26):** hhh-dev is now also the **work branch for new feats** — branch new features off it
directly, no more `v11.10.1-feat/*` chain branches. See [[feedback_directus_new_feat_base_hhh_dev]] (fetch +
sync hhh-dev before starting).

**How to apply:** to update hhh-dev, merge the leaf PR (squash). Editing any low PR cascades a force-push rebuild of every branch above it — see [[project_directus_stacked_chain_dep_bump]] for the lockfile/catalog traps and [[feedback_head_branch_push_after_cascade]] for the push pitfall. hhh-dev being prepare-based means it carries fork CI/.agents — intended for an integration branch.
