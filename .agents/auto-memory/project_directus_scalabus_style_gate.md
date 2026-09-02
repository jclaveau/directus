---
name: project_directus_scalabus_style_gate
description: The scalabus diff-scoped eslint style gate — eslint.style.config.js + lint-style-changes.mjs, prettier disabled, config-is-source, two-pass --fix
metadata:
  type: project
---

A second, scalabus-only eslint layer enforces jean's planner code-style on NEW lines only, alongside
directus's own `eslint.config.js`. Built #205 (2026-06-30). Files:

- **`eslint.style.config.js`** (root, INERT — eslint auto-loads only `eslint.config.js`) — jean's planner
  config ([[feedback_adopt_jeans_proven_configs]]) + `eslint-rules/` (his `custom-array-element-newline` +
  a new `arrow-multiline-block`). **Commented out** (prettier still owns / whole-file-churn): `indent`, `semi`,
  `quotes`, `space-unary-ops`. **On**: max-len(code:90, comments:110, `ignoreStrings` OFF + `ignorePattern`
  `^\s*(it|test|describe)\(|^\s*\]\)\(` for unbreakable test titles), multiline-ternary, brace-style stroustrup,
  curly, the verticalizers, prefer-template. Preset quality rules (`@typescript-eslint/no-explicit-any`,
  `no-redeclare`) turned **off** so only style fires.
- **`scripts/lint-style-changes.mjs`** (`pnpm lint:style:changes`, the `Style (changes)` CI job) — runs eslint
  with that config, reports **every error it emits on ADDED lines only** (git-diff intersection). CONFIG IS THE
  SINGLE SOURCE (no hardcoded rule list). Exempts tooling paths (`eslint-rules/`, `scripts/`, `*.config.*`) +
  handles UNTRACKED files ([[reference_git_diff_skips_untracked]]).

Key mechanics / gotchas:
- **prettier FULLY DROPPED (2026-07-02, #205)** — was "disabled" (Format job = no-op); now the tool is gone: deleted `.prettierrc.json`/`.prettierignore`, the `format` script, the `prettier` devDep + catalog entry, the VS Code rec; `Format` CI job kept as a green no-op for branch protection. `eslint.style.config.js` is the sole style authority. **`eslint-config-prettier` KEPT** — still suppresses ESLint/Vue formatting rules in the correctness lint (`eslint.config.js`). Don't run `prettier --write` — it reverts the eslint-style verticalizers.
- **Reproduce the gate LOCALLY before push, don't hand-filter** — run `node scripts/lint-style-changes.mjs <PR-base-SHA>` (or `LINEWIDTH_BASE=`); it diffs merge-base→worktree. A per-file `eslint --config eslint.style.config.js <file>` filtered by eye to added line numbers MISSES things (2026-07-02: a code line pushed to 106 cols by an added import survived my per-file check, caught only by the CI gate). The gate script is the source of truth — bit me once, cost a red CI + extra push.
- **Two eslint configs coexist without fighting**: the style config's stroustrup/curly restructure blocks →
  trips directus's `padding-line-between-statements`; fix with a **two-pass `--fix`** (style config first, then
  directus's `eslint --fix` for padding). Neither reverts the other (directus config has no brace/ternary rules;
  style config has no padding rule).
- **`--fix` needs the indent rule** — see [[reference_eslint_fix_needs_indent_rule]].
- Tooling files (`eslint-rules/**`, `scripts/lint-style-changes.mjs`) are also excluded from directus's
  `eslint.config.js` `ignores` and from codecov `ignore`.

**`string-literals-max-len` rule + `oneLine` (added #205, 2026-07-01)** — max-len can't break a string
literal (one token), so `ignoreStrings`/`ignoreTemplateLiterals` end up exempting whole lines → long
titles grow unbounded AND soft-wrap in the review pane.
- **`oneLine`** — template tag in `@directus/utils` (`packages/utils/shared/one-line.ts`; api + blackbox
  both dep on it → same import specifier) collapsing a wrapped multi-line source string to one line. Impl
  = `split('\n').map(trim).filter(nonempty).join(' ')` — LINEAR, not a regex (a `\s*\n\s*` regex is a
  ReDoS on a public export — [[reference_codeql_redos_public_util]]).
- **`eslint-rules/string-literals-max-len.js`** (renamed from `test-title-oneline`) — the max-len arm for
  breakable string literals: a `test`/`it`/`describe` title over the cap is fixed to `oneLine\`…\`` and
  **word-wrapped** so every source line ≤90 (a title on ONE line inside the tag can still exceed 90 → pack
  words per line). Re-flags an under-wrapped `oneLine`. Fixer injects/merges the `@directus/utils` import.
  Options `code/tabWidth/indent/tag/importModule`.
- **max-len change**: `ignoreTemplateLiterals` now OFF everywhere (ts + vue blocks); `ignoreStrings` stays
  off; kept only the `it|test|describe(` opening-line `ignorePattern` (that rule owns titles; wrapped body
  lines still checked). Value-bearing long templates it surfaces (URLs, error strings, `.each` data) have
  NO fixer → hand-wrap (break the object / extract a param var). Renames cascade pre-existing long lines in
  — [[reference_rename_full_add_diff_gate]].

Related: [[feedback_avoid_review_pane_soft_wrap]] (the origin), [[reference_eslint_maxlen_quirks]],
[[feedback_no_coverage_in_test_names]].

**`pnpm lint:style:changes` passes VACUOUSLY outside CI.** With no base ref it prints
`lint:style:changes: no base ref, skipping` and exits 0 — a green that checked nothing
([[reference_gate_can_pass_vacuously]]). The base comes from the first argv or
`$LINEWIDTH_BASE`. Run it as
`node scripts/lint-style-changes.mjs origin/v11.10.1-hhh-dev` and require the real
`✓ no added lines breaking style` line before believing it. In a worktree this works
fine (node_modules is symlinked to the main tree).

## 2026-08-21 (#373)

- **`.claude/hooks/*.mjs` is NOT exempt.** `isToolingPath` covers `eslint-rules/`, `scripts/`
  and `*.config.*` only, so hook scripts face the 85-col rules and the base config, where
  `no-console` is an ERROR — print with `process.stdout.write`.
- **The gate now prints `local/*` warnings as advice** above the verdict, on added lines,
  without touching the exit code (`severity === 2` still decides). Before that the custom
  rules ran on every changed line and their output was discarded.
- **`.claude/hooks/eslint.mjs`** runs a second report-only pass with the style config after
  its `--fix` pass, scoped by `git diff --unified=0 HEAD -- <file>`. Hooks register at
  SessionStart, so a change there only takes effect next session.

