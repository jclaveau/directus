---
name: project_directus_contributor_check_author
description:
  The fork's "Check" workflow rejects PR commits whose author email isn't GitHub-associated — author commits as
  jean's GitHub noreply, not his gmail.
metadata:
  type: project
---

The fork's **"Check" workflow** validates `contributors.yml` against every PR commit and throws
`Error: PR contains commits without associated GitHub users` if a commit author email doesn't resolve to a
GitHub account.

- **Author commits as `Jean Claveau <1556489+jclaveau@users.noreply.github.com>`** — the GitHub-associated
  noreply. `comptes.jc@gmail.com` (the session `userEmail`) is NOT linked on the GH account → fails the check.
- The original fork commits all use the noreply (`git log --format='%ae'`); match that.
- Fix after the fact: `git -c user.name="Jean Claveau" -c user.email="1556489+jclaveau@users.noreply.github.com"
  commit --amend --reset-author --no-edit`, or rebase the chain with an `--exec` that re-authors any commit whose
  `%ae` == the gmail.

**Why:** cost a full CI cycle this session — 5 commits authored with the gmail failed Check across the stack.
**How to apply:** always pass the noreply `user.email` to every commit you author in this repo (commits, amends,
rebase re-authors). Related: [[project_directus_compose_copy_stack]] (cla-bot reads contributors.yml from head ref).
