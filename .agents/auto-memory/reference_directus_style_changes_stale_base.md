---
name: reference_directus_style_changes_stale_base
description: CI Style (changes) diffs against the PR's base.sha; an old base makes it lint trunk lines the PR never touched — merge hhh-dev in, don't chase them
metadata:
  type: reference
---

`Style (changes)` lints the lines added between the PR's `base.sha` and its head. When the
branch was cut from an old hhh-dev tip, lines that landed on the trunk since then count as
"added" by the PR, and a style rule tightened on the trunk meanwhile turns the job red on code
the PR never wrote.

Seen on #680 (head ade3aa2626, Style run 42612715803 red); after `git merge origin/v11.10.1-hhh-dev`
(head ceda8f2790) Style 42614435824 went green with no code change.

**How to apply:** a red Style (changes) whose flagged lines are not in `gh pr diff` → merge
hhh-dev into the branch and push; never hand-fix trunk lines in the PR. Locally,
`node scripts/lint-style-changes.mjs origin/v11.10.1-hhh-dev` after a fetch shows the same gate
against the current tip. See [[project_directus_scalabus_style_gate]].
