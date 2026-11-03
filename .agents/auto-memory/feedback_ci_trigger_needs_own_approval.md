---
name: feedback_ci_trigger_needs_own_approval
description: A label or dispatch is its own approval, never implied by "merge once green"; a rerun of a likely flake on this PUBLIC fork is NOT — rerun at once, unasked
metadata:
  type: feedback
---

Adding a label, dispatching a workflow, or forcing a rerun spends CI money/time
and is a distinct action from whatever goal it serves — it needs its own ask,
never inferred from an adjacent instruction.

**Why:** told "merge once green" on a consumer PR, inferred that meant "make
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

**Reruns are out of this rule (2026-11-02, jean):** this fork is public, so its
runs are free. A known flake / timing guard / runner error → `gh run rerun <run>
--failed` as soon as the run completes, once, without asking ("i already told you
to stop asking me for reruns on public hence free runs repos"). Only two reasons justify asking
first: cost (a PRIVATE repo, paid minutes) and GHA runner contention
(`~/.agents/scripts/gha-contention.sh`, account-wide). Labels and dispatches keep needing their
own ask. See the cross-repo [[feedback_rerun_likely_flaky_without_asking]] and
[[feedback_local_vs_ci_gate_by_repo_visibility]].
