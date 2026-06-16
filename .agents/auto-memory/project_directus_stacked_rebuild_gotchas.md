---
name: directus-stacked-rebuild-gotchas
description:
  Gotchas building the hhh-main copy stack via cherry-pick — branches are independent (fix low → rebuild above),
  divergent stacked history isn't a mechanical rebase, merge-tree forced-base lies, and the test-file two-block merge.
metadata:
  type: project
---

Hard-won while building the conflict-resolved copy stack ([[directus-compose-copy-stack]]).

- **Cherry-pick branches are independent — they do NOT inherit a parent's fix.** Each `hhh-main-stacked-*` is its own
  commits; fixing a low PR (e.g. #48's dialect-test merge) does NOT propagate to the branches above it. A fix near the
  bottom forces **re-rolling the whole chain above** (re-cherry-pick + re-resolve). Sequence fixes before building up.

- **Divergent stacked history = reconciliation, not rebase.** #52 (cancel-mutations) is "based on" #51 in the PR, but
  its branch carries its OWN takeover commit (different SHA than #51's). `git cherry-pick base..head` re-applies a
  duplicate → conflicts on items.ts. Such a PR can't be mechanically stacked; it needs real reconciliation. Detect: the
  same commit subject appears with two SHAs across the two branches.

- **`git merge-tree --merge-base=origin/main` LIES when branches are behind main.** Forcing the merge-base invents false
  "revert" conflicts (e.g. on `compose-hhh-main.yml`/`contributors.yml`) because the stale branch "lacks" newer main
  commits. Trust the **real `git merge`** result + **three-dot diffs** (`origin/main...pr`) for true overlap.

- **Test-file two-block merge pattern.** When a conflict is two sibling `describe`/`it` blocks (both PRs append at the
  same spot), keep BOTH — but the first block's closing `});` was usually in the conflict-excluded region, so naive
  marker-stripping leaves it unclosed → `Unexpected end of file`. Resolution:
  `HEAD-body + "\n});" (close the first) + theirs-body`; the common closing after the conflict closes the last block.
  Same for `it(...)` and SchemaBuilder fixtures (merge fields, don't pick one side).

- **Semantic (non-textual) interactions surface only in tests.** #50 (skip no-op empty updates) silently broke #58's
  await-update test which used an empty `{}` payload → now a no-op skip → action never fires. Git merged clean; only the
  api test caught it. Run the full api test on the assembled hhh-main, not just per-file.
