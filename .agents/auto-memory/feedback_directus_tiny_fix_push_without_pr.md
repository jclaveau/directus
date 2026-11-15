---
name: feedback_directus_tiny_fix_push_without_pr
description: a one-line CI/workflow fix goes straight to v11.10.1-hhh-dev, no PR, no ask
metadata:
  type: feedback
---

A tiny fix (one line, CI/workflow config, no product code) is pushed straight onto
`v11.10.1-hhh-dev` — no branch, no PR.

```
mollie-behaviour.yml   runs-on: ubuntu-latest → ubuntu-24.04   → 4922b0eb1f on hhh-dev
```

**Why:** jean, 2026-11-15, asked whether to open a PR for that line: _"push without
pr for such a little change"_. Each PR costs jean a review round and CI; he already
complained about too many PRs.

**How to apply:**
- `git worktree add --detach <scratch> origin/v11.10.1-hhh-dev`, edit, commit with
  the `Assisted-by:` trailer, `git push origin HEAD:v11.10.1-hhh-dev`, remove the
  worktree. Never switch the current checkout.
- Product code, tests, anything beyond a trivial line → still a PR
  ([[feedback_directus_new_feat_base_hhh_dev]]).
