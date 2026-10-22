---
name: feedback_run_the_gates_of_the_repo_you_edited
description: When a task spans the fork and the planner, run the gates of the repo each edit actually lands in — carrying the other repo's habits over ships red CI
metadata:
  type: feedback
---

A session that moves between `directus-cms-2` and `planner_2` builds a habit for one
repo's gates and then edits the other without switching. Shipped a red `Lint` job on
Planner PR #751 this way: ran `node --check` on
`apps/directus/directus.ecosystem.config.js` and pushed, having run the **fork's** two
eslint configs all session and never the planner's.

**Why it bites:** the two repos disagree on style. The planner's `apps/directus` enforces
`quotes: backtick`; the fork does not. The flags string was copied from the line it
replaced — `// node_args: '--max-old-space-size=4096'` — which passed only because a
comment is not linted. Copying from adjacent code is normally the right instinct, and it
is exactly what fails when the adjacent line is commented out.

**How to apply:**
- Before pushing, run the gate of the repo the file lives in, not the one you were last in.
  Planner: `pnpm lint` (per-package `eslint`; `apps/directus` is its own package).
  Fork: `pnpm lint` **and** `node scripts/lint-style-changes.mjs <base>` — see
  [[project_directus_two_eslint_configs]].
- `node --check` proves syntax, never style. It is not a lint gate.
- Never treat a commented-out line as a style reference.
- `develop` is shared: fix a pushed mistake with a follow-up commit, never `--amend`
  (which [[feedback_amend_ok]] permits only on your own feature branches).
