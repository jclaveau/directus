---
name: feedback-amend-ok-in-directus-pr-flow
description:
  Amending the prior commit is acceptable in this Directus PR-flow context without asking; force-with-lease push
  afterwards is fine.
metadata:
  type: feedback
---

When iterating on a not-yet-merged feature branch in this repo, amending the previous commit (instead of layering a
follow-up commit) is fine — don't ask first, don't apologize after. Force-with-lease push is the expected follow-up.

**Why:** Reviewers on the upstream-bound PRs care about a tight, scoped diff per logical change; layered "fix-up"
commits add noise. The user explicitly OK'd amending after I flagged it.

**How to apply:**

- Default to `git commit --amend --no-edit` (or `--amend` with an updated message when scope shifts) when extending the
  most recent commit's scope.
- Follow up with `git push --force-with-lease` — never plain `--force`.
- This override is scoped to this project's feature branches (the upstream-bound PR work). On `main`/published shared
  branches, fall back to the global default of creating new commits.
