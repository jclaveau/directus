---
name: reference_directus_style_changes_vs_lint_split
description: Directus CI "Style (changes)" gate checks line WIDTH only; full-lint rules (padding-line-between-statements etc.) fire in the separate "Lint" job — a width-motivated wrap can pass one and fail the other
metadata:
  type: reference
---

Directus CI runs two independent eslint-based jobs in the Check workflow:

- **Style (changes)** — the changed-line gate ([[feedback_avoid_review_pane_soft_wrap]] / [[reference_eslint_maxlen_quirks]]). Runs the **whole `eslint.style.config.js` ruleset** on added lines only — NOT width-only (that framing was wrong). Fires `max-len` AND `prefer-template`, `no-trailing-spaces`, `brace-style` (stroustrup — `} else {` must split), `local/string-literals-max-len`, `newline-per-chained-call`, `local/arrow-multiline-block`, etc. **2026-07-27 (#311):** I grepped the `lint:style:changes` output for `max-len` only and shipped a red — the gate also flagged 4 `prefer-template` (`'x' + y` in moved helpers), 6 `no-trailing-spaces` (generated tab-only "blank" lines), 4 `brace-style`. **Read the FULL gate output, never `grep max-len`.**
- **Lint** — the whole-file base eslint (`eslint.config.js`) over the PR's changed files. This is where `padding-line-between-statements` lives (NOT in Style (changes)).

**Trap:** wrapping a one-line statement across lines to satisfy the 90-col Style gate can turn a single-line const into a *multiline* statement, which `padding-line-between-statements` then requires blank lines around → **passes Style (changes), fails Lint**. Bit PR #212: a 90-col wrap of a `writeRow({...})` object in a blackbox test (commit `39b3ee89ab`) tripped Lint at `cache.test.ts:2004,2008`; fix = blank lines before the const and the following `expect` (`550a639f30`).

**How to apply:** after any width-motivated wrap, run the FULL `pnpm exec eslint <file>` locally (not just the width check) before pushing — the two gates are separate check runs and green-on-one ≠ green-on-both. `padding-line-between-statements` is `--fix`-able.
