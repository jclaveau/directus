---
name: project_directus_issue_autoclose_hhh_dev
description: on jclaveau/directus since 2026-07-27 `v11.10.1-hhh-dev` IS the default branch, so a PR's `Closes #N` now auto-closes on merge to hhh-dev — manual close only needed for PRs merged BEFORE the default flip
metadata:
  type: project
---

**UPDATED 2026-07-27: the default branch flipped to `v11.10.1-hhh-dev`** (pr-controle retired,
[[directus-fork-integration-branches]]). GitHub auto-closes a `Closes #N` / `Fixes #N` issue only
when the linking PR merges into the **default branch** — so now that hhh-dev IS the default,
`Closes #N` **fires normally** on hhh-dev merges. No more manual close needed for new PRs.

**Historical (while default was `pr-controle`):** feature PRs merged into hhh-dev (non-default),
so the keyword never fired — hit 3× in one session (#285→#282, #288→#287, #289→#283).

**Transition gotcha:** a PR that merged into hhh-dev *just before* the flip still won't have
auto-closed (default was still pr-controle at merge time). Seen with #299: #301 merged 07:54, the
default flip was ~08:33, so #299 stayed open and was closed manually.

**How to apply:** for a PR merged before the flip (or any that didn't fire), close manually:
```
gh issue close <N> -R jclaveau/directus -r completed -c "Fixed by #<PR> (merged into \`v11.10.1-hhh-dev\` <date>, \`<sha>\`). <one-line mechanism>."
```
`gh issue close/comment` are unaffected by the classic-Projects GraphQL bug
([[gh-issue-view-quirk]]); only `gh issue view` / `gh pr edit` are.
