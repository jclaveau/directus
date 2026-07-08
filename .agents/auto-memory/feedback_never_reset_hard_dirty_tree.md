---
name: feedback_never_reset_hard_dirty_tree
description: never `git reset --hard` to clean up a dry-run when the tree has pre-existing uncommitted work — it nukes unstaged mods; scope the cleanup instead
metadata:
  type: feedback
---

Ran `git cherry-pick --no-commit` as a dry-run, then `git reset --hard HEAD` to clean up — which ALSO discarded jean's 3 pre-existing uncommitted test-file mods (they were ` M` in working tree, never staged → no git object → unrecoverable from reflog/fsck).

**Why:** `reset --hard` resets ALL tracked files to HEAD, not just the dry-run's files. Unstaged working-tree changes leave no blob, so they're gone for good unless committed elsewhere.

**How to apply:**
- To undo a `--no-commit` cherry-pick/merge: `git cherry-pick --abort` (if a sequence is active) or `git restore --staged --worktree <only-the-picked-paths>` — never blanket `reset --hard` over a dirty tree.
- Before any destructive tree op, check `git status --short` for pre-existing ` M`/`??` work and protect it: scoped `git stash push <pathspec>` (no `-u`, see [[feedback_stash_u_swallows_agents_dir]]).
- Recovery when it happens: the lost content may already be committed on a sibling branch — here the test mods were `cp`-ed + pushed to `origin/v11.10.1-feat/forbidden-reasons` in a prior session, so `git rev-parse <branch>:<path>` gave byte-exact blobs. Also mine Claude session transcripts (`~/.claude/projects/<enc>/*.jsonl`) for Edit/Write tool calls — they store exact old/new content. See [[reference_session_migration_after_repo_rename]] for transcript locations.
