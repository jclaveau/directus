---
name: project_directus_pr373_accepted_exceptions
description: PR #373 "warn on a const read once and a function called once" — MERGED 2026-08-21; the two custom eslint rules' settled contract, what is deliberately not detected, and the fact they gate nothing yet
metadata:
  type: project
---

Merged into `v11.10.1-hhh-dev` as `004a131d1e`. `eslint-rules/no-single-use-const.js`,
`no-single-caller-function.js`, shared `vue-template-identifiers.js`, suite
`single-use-rules.test.mjs` (`pnpm lint:rules:test`, run by the `Style (changes)` job).

Settled by jean — do NOT re-raise:

- **An export is a name, not a use.** No blanket exemption for exported symbols; the
  reference sitting in an export list simply is not counted. `export { foo }` alone = 0 uses
  (quiet, the rules fire at exactly 1); `export function foo(){}; foo()` = 1 use and WARNS.
  His call, made against my flagged concern that external callers are invisible.
- **A name the template mentions disqualifies the declaration**, in both rules — call or bare
  reference alike, because a template expression has nowhere to put a body or a multi-line
  initializer. Counting template calls as callers was tried first and rejected.
- **`typeof foo` counts as the one use.** Reviewed, kept, pinned by a test.
- **The template check is by NAME**, so an inner local/helper sharing a name the template uses
  is skipped too. Known, pinned as a case, fails safe (missed report, never a wrong one).
- **`ref="el"` and `<style> v-bind()`** are invisible; the `<script setup>` declaration-marker
  filter is what keeps them quiet. Mechanics in [[reference_vue_eslint_scope_analysis]].
- **Both rules are `warn`, and `warn` gates NOTHING**: `lint-style-changes.mjs` collects
  `severity === 2` only. They print as advice — in the CI Style log and, since this PR, from
  the `.claude/hooks/eslint.mjs` per-edit pass (scoped to the lines an edit added). Flipping
  either to `error` in `eslint.style.config.js` is the one switch that makes them binding.

Current volume if ever gated: `api/src` 1222 const + 199 caller; `app/src` 327 + 302.

**How to apply:** reviewing these rules in a clean session, read this first — the "obvious"
findings above are closed. [[feedback_claim_needs_the_test_not_a_probe]].
