---
name: project_directus_local_gate_noise
description: on this directus fork `pnpm lint:style` (stylelint) fails locally with 6 pre-existing upstream errors while CI's Stylelint check is green — don't chase them; the gates that actually mean something are eslint + lint-style-changes
metadata:
  author: Jean Claveau
  type: project
---

`pnpm lint:style` exits 2 locally with **6 `property-no-vendor-prefix` errors**, all in
untouched upstream files:

```
app/src/components/v-input.vue                -webkit-user-select
app/src/components/v-resizeable.vue           -webkit-user-select
app/src/components/v-field-template/…         -webkit-user-select
app/src/styles/_base.scss                     -webkit-appearance
app/src/styles/lib/_codemirror.scss           -webkit-mask-image  ×2
```

CI's `Stylelint` check passes on the same tree, so this is local-only noise (cache/config
divergence, not a regression). **Do not "fix" them** — that would reformat upstream files for
nothing, against the keep-diffs-minimal rule in AGENTS.md.

The gates worth running before a push, in order:

```bash
npx eslint <changed files>                                   # base config, must be silent
node scripts/lint-style-changes.mjs origin/v11.10.1-hhh-dev  # THE style gate, added lines only
```

`lint:style:changes` prints `no base ref, skipping` **and exits 0** when given no argument —
a skip that reads as a pass. Always pass the base ref explicitly.

**Why:** I re-derived the stylelint verdict twice in one session before concluding it was
pre-existing. Related: [[feedback_eslint_style_first_pass]], [[feedback_gate_before_commit_chain]].

**Stale branch + style gate (2026-11-06, #686):** when the branch is behind base, the diff
counts old upstream lines of a rewritten function as "added" (local flagged 3: two brace-less
`if … continue;`, one 100-col line). Local was dismissed as noise because CI Style had been
green — but after the next push CI flagged the same 3. Wrap them (braces + width) rather than
dismissing; sync with base first to shrink the diff.
