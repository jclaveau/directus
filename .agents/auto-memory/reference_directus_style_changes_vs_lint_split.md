---
name: reference_directus_style_changes_vs_lint_split
description: Directus CI "Style (changes)" gate checks line WIDTH only; full-lint rules (padding-line-between-statements etc.) fire in the separate "Lint" job — a width-motivated wrap can pass one and fail the other
metadata:
  type: reference
---

Directus CI runs two independent eslint-based jobs in the Check workflow:

- **Style (changes)** — the changed-line gate ([[feedback_avoid_review_pane_soft_wrap]] / [[reference_eslint_maxlen_quirks]]). Enforces the 90-col `max-len` on added lines only. Width-only — does NOT run the full ruleset.
- **Lint** — the whole-file eslint over the PR's changed files, full ruleset incl. `padding-line-between-statements`.

**Trap:** wrapping a one-line statement across lines to satisfy the 90-col Style gate can turn a single-line const into a *multiline* statement, which `padding-line-between-statements` then requires blank lines around → **passes Style (changes), fails Lint**. Bit PR #212: a 90-col wrap of a `writeRow({...})` object in a blackbox test (commit `39b3ee89ab`) tripped Lint at `cache.test.ts:2004,2008`; fix = blank lines before the const and the following `expect` (`550a639f30`).

**How to apply:** after any width-motivated wrap, run the FULL `pnpm exec eslint <file>` locally (not just the width check) before pushing — the two gates are separate check runs and green-on-one ≠ green-on-both. `padding-line-between-statements` is `--fix`-able.
