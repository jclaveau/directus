---
name: feedback_ci_trigger_needs_own_approval
description: A CI-triggering action (label, dispatch, rerun) is its own approval — never implied by a broader instruction like "merge once green"
metadata:
  type: feedback
---

Adding a label, dispatching a workflow, or forcing a rerun spends CI money/time
and is a distinct action from whatever goal it serves — it needs its own ask,
never inferred from an adjacent instruction.

**Why:** told "merge once green" on planner PR #749, inferred that meant "make
the gate go green" and added the `all-tests` label myself — 9 browser shards +
smoke + extra builds, broader than the `front-tests` label already offered and
left unanswered earlier in the session. User had not asked for the label; the
gate needing it to ever go green doesn't make adding it part of the original
instruction. Correct move would have been: "merge-gate needs the label to ever
go green — add it?" and wait.

**How to apply:** treat label/dispatch/rerun as needing explicit sign-off, same
tier as `git push` or opening a PR. An unanswered earlier offer is a "no," not
a standing yes to raise later. When multiple label scopes exist, propose the
narrowest one that would satisfy the ask, not the catch-all. See
[[feedback_ask_before_branch_switch_and_pr]] for the sibling rule on branch/PR
actions.
