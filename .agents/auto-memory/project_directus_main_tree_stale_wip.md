---
name: project_directus_main_tree_stale_wip
description: The main tree's September WIP (13 conflicted + ~18 modified files) was diffed against hhh-dev, judged worthless and parked in tmp/main-tree-wip-2026-09/ on 2026-10-22; the main tree's memories had drifted from hhh-dev's and were merged
metadata:
  author: Jean Claveau
  type: project
---

Main tree `directus-cms-2` sat on `v11.10.1-perf/batch-nested-inserts` (PR #427, merged) with WIP from 2026-09-06..10. Cleaned 2026-10-22, at jean's go.

- The 13 `UU` files were a `git stash pop` (markers `Updated upstream` / `Stashed changes`) of the June scoped-cache attempt — old names `cache_scope_fields`, `CACHE_AUTO_PURGE_MODE`, the same content `stash@{2}` labels "dropped". No `MERGE_HEAD`, so `merge --abort` does nothing; `git restore --source=HEAD --staged --worktree` clears it.
- The other modified/untracked code (processes charts hover-hold, extensions-sdk `APP_ONLY_PACKAGES` + bundle-size line, autoscale-panel) was already on hhh-dev in a newer form.
- Backup kept: `tmp/main-tree-wip-2026-09/` (`tracked.diff`, `untracked.tar`, `untracked/`).
- Memories had diverged both ways: the main tree (where auto-memory writes land) and hhh-dev (memories committed from worktrees) each edited the same files. Merged on `v11.10.1-chore/sync-agent-memories`: newer side per file, index + flake log keep both.

**Why:** auto-memory writes into the main tree's checkout, so a main tree left on a stale branch drifts from what hhh-dev holds.
**How to apply:** keep the main tree on a current hhh-dev-based branch; before committing memories from it, `git diff HEAD origin/v11.10.1-hhh-dev -- .agents` to catch a two-sided edit.
