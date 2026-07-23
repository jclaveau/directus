---
name: project_directus_issue_autoclose_hhh_dev
description: on jclaveau/directus, a PR's `Closes #N` does NOT auto-close the issue because PRs merge into v11.10.1-hhh-dev (not the default branch) — close the issue manually after merge
metadata:
  type: project
---

GitHub only auto-closes a `Closes #N` / `Fixes #N` issue when the linking PR merges into
the repository's **default branch**. On this fork the default branch is **`pr-controle`**
(see [[project_directus_preview_infra]]), and feature PRs merge into **`v11.10.1-hhh-dev`**
— so the keyword never fires and the issue stays OPEN after merge.

**Why:** hit 3× in one session — #285→#282, #288→#287, #289→#283 all left their issues open
despite a merged `Closes #N` PR.

**How to apply:** after squash-merging a feature PR into hhh-dev, **close the linked issue
manually**:
```
gh issue close <N> -R jclaveau/directus -r completed -c "Fixed by #<PR> (merged into \`v11.10.1-hhh-dev\` <date>, \`<sha>\`). <one-line mechanism>. Didn't auto-close because #<PR> merged into hhh-dev, not the default branch."
```
`gh issue close/comment` are unaffected by the classic-Projects GraphQL bug
([[gh-issue-view-quirk]]); only `gh issue view` / `gh pr edit` are.
