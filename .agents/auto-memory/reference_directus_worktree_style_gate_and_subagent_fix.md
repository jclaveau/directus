---
name: reference_directus_worktree_style_gate_and_subagent_fix
description: In a worktree `pnpm lint:style:changes` tries to reinstall and fails (node_modules is a symlink) — run the gate script/eslint directly; a style-fixing subagent strips eslint-disable comments and makes non-format edits
metadata:
  author: Jean Claveau
  type: reference
---

In a worktree, `pnpm lint:style:changes` (and `pnpm lint`) trigger a pnpm auto-install that fails, because `node_modules` is a symlink to the main tree ([[project_directus_worktree_shared_node_modules]]). Run the gate script / the eslint binary directly with a small shim instead.

**Why:** #673 session: 221 style errors on added lines (mostly >85 cols); the pnpm entry point could not run, cost several retries.

**How to apply:**
- Run the eslint.style config directly over the added-lines set; then run base `pnpm lint` equivalent the same way. Re-run both after the LAST edit.
- A subagent told to fix style: `--fix` mangled indentation on new files, deleted `no-console` eslint-disable comments (`app/src/utils/sync-app-chunk.ts`), added a single-use const and merged two imports. Diff its work (`git diff`) for non-format edits and restore the disable comments before committing.
- Red-tests-first flow: commit tests alone, push, open PR, then push the implementation commit once CI shows red for the right reasons.
