---
name: project_directus_stacked_chain_dep_bump
description: bumping a catalog dep low in the v11.10.1 stacked chain — pnpm lockfile only regens cleanly from a branch's OWN consistent state; rebasing onto a bumped base then regen drifts the whole graph
metadata:
  type: project
---

Bumping a pnpm **catalog** dep (e.g. rolldown beta.9→1.1.3) inside the stacked feat chain has two traps that cost a long session:

**1. Lockfile drift.** `pnpm install --lockfile-only` regens CLEANLY (~150-300 lines, only the dep's subtree) **only when run on a branch whose package.json↔lockfile already match** (its own committed state). If you rebase a branch onto a parent that bumped the catalog FIRST, the inherited lockfile no longer matches that branch's package.json → regen re-resolves the WHOLE graph to latest (5000+ lines, @aws-sdk/@azure/esbuild/@types-node drift). Fix: do the entire bump (catalog edit in pnpm-workspace.yaml + the `"dep": "catalog:"` package.json edits + `pnpm install --lockfile-only`) on ONE branch from its clean origin state, commit, THEN cascade. pnpm is pinned via `packageManager` (10.34.4) — version match is NOT the cause; staleness is.

**2. Catalog line context-revert on rebase.** A branch whose own commit edits pnpm-workspace.yaml near the bumped line reverts it. e.g. #190 adds `rolldown-plugin-istanbul:` to the catalog — alphabetically ADJACENT to `rolldown:` — so rebasing it onto the 1.1.3 base, git's 3-way merge carries the hunk's old `rolldown: beta.9` context and silently reverts line 259. No conflict shown. Fix: after rebasing such a branch, re-`sed` the catalog line to the target + `pnpm install --lockfile-only` to reconcile (minimal churn since its lockfile already matches its pkgs); commit as a "reconcile" step. Or rebase with `-X ours`/`-X theirs` on the generated files, then normalize.

**How to apply:** verify after EACH dep-touching branch in the cascade — check `pnpm-workspace.yaml` has the right version AND the lockfile diff vs parent has zero non-target packages. Tools: `git interactive rebase -i` is unavailable here, so amend the tip / add a reconcile commit instead. See [[project_directus_linear_chain_leaf_pr]], [[feedback_head_branch_push_after_cascade]], [[reference_rolldown_110_define_moved]] (the 1.1.3 bump also needed a `transform.define` code fix).
