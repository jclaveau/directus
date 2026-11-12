---
name: feedback_directus_knex_pin_pr_by_intent
description: A knex pin bump PR carries the Directus cleanup its knex commits enable, in the same PR; a knex commit for an unrelated goal gets its own pin PR
metadata:
  type: feedback
---

Split a knex pin bump by intent ([[feedback_split_prs_by_intent_not_content]]), not by repo:

```
knex commit d4a8257c  json mode prepares Date/bigint   (goal: #636)
knex commit knex#4    whereIn past 65535 values        (goal: a consumer's need)

wrong:  #637 = pin(both) ; #638 = #636 Directus cleanup
right:  PR A = pin(knex#4)                        for the consumer's need
        PR B = pin(d4a8257c) + items.ts cleanup   Fixes #636
```

**Why:** jean, 2026-10-26, on #637/#638. #637 shipped only the pin, with `Refs #636`. That left `items.ts` preparing values that knex already prepared, until #638 landed. Pushing the #636 cleanup into a separate PR split one goal across two PRs. It also bundled an unrelated urgent fix, knex#4, into the #636 pin.

**How to apply:**
- Before opening a knex pin PR, run `git log <old>..<new>` on the fork and group the commits by goal.
- For each goal, open one PR: the pin plus the Directus changes those commits enable, closing that goal's issue with `Fixes #N`.
- When two goals need the same pin sha, say so and ask which order to land them in.

Related: [[project_directus_knex_fork_switch]], [[project_directus_issue636_batch_to_db_layer]].
