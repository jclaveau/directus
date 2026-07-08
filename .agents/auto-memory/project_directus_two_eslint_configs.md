---
name: project_directus_two_eslint_configs
description: directus fork has TWO eslint configs (correctness + style-gate) checked by SEPARATE CI jobs; the style gate alone misses correctness-rule failures — run both locally before push
metadata:
  type: project
---

The fork's lint is split across two configs enforced by two different CI check-runs. Verifying only one before push → CI red on the other.

- **Correctness Lint** (`eslint.config.js`, CI job **"Lint"**) — full ruleset incl. `padding-line-between-statements`, `newline-per-chained-call`, `no-duplicate-imports`, import/order. Runs over the whole changed file. Invoke locally: `pnpm exec eslint <files>`.
- **Style gate** (`eslint.style.config.js`, CI job **"Style (changes)"**) — diff-scoped to ADDED lines only via `scripts/lint-style-changes.mjs <baseRef>`; enforces `max-len` (code 90, comments 110, `ignoreStrings`), `local/string-literals-max-len` (long test titles must be `oneLine`-wrapped), multiline-ternary. Locally needs a base: `node scripts/lint-style-changes.mjs origin/<base-branch>` (else "no base ref, skipping"). `pnpm lint:style:changes` reads `$LINEWIDTH_BASE`.

**Why:** shipped a push whose `Lint` job failed `padding-line-between-statements` (a `switch` with `case`-blocks after fall-through labels) even though the style gate was green — the style config doesn't include that rule. Burned a CI cycle.

**How to apply:** before ANY push touching `.ts`, run BOTH `pnpm exec eslint <changed files>` AND `node scripts/lint-style-changes.mjs origin/<base>`. Fix for the case-block padding trap: rewrite `switch` as `if`-returns (keep ternaries multiline for the style gate). Related: [[reference_eslint_maxlen_quirks]], [[feedback_avoid_review_pane_soft_wrap]].
