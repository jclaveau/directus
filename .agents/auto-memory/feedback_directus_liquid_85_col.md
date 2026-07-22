---
name: feedback_directus_liquid_85_col
description: jean wants the 85-col style cap applied to .liquid files too; now enforced (not manual) via a no-op-parser block in eslint.style.config.js + the gate glob
metadata:
  type: feedback
---

jean: "follow the 85 max-len for .liquid files".

**Why:** `.liquid` env templates (e.g. `api/src/cli/utils/create-env/env-stub.liquid`)
were exempt from the width cap — comment blocks there soft-wrap in the review pane like
any over-85 source line. He wants them held to the same bar as ts/js/vue.

**How to apply:** now WIRED, not manual (do NOT hand-count):
- `eslint.style.config.js` — a `rawTextParser` (no-op `parseForESLint` returning an empty
  `Program`) + a `{ files: ['**/*.liquid'], languageOptions: { parser: rawTextParser },
  rules: { 'max-len': [85, tabWidth 2, comments 85] } }` block. espree can't parse Liquid,
  but `max-len` is line-based (reads `sourceCode.lines`), so the empty AST is enough. ONLY
  `max-len` on `.liquid` — no JS style rules (it's a template, not code).
- `scripts/lint-style-changes.mjs` — `*.liquid` added to BOTH globs (diff + untracked), so
  the diff-scoped gate reports over-length ADDED liquid lines.
- Full-file eslint on a `.liquid` shows many pre-existing >85 hits; the gate only flags
  your added lines, same as every other file.

Landed in PR #289. Related: [[feedback_avoid_review_pane_soft_wrap]], [[reference_eslint_maxlen_quirks]],
[[feedback_eslint_style_first_pass]], [[project_directus_two_eslint_configs]].
