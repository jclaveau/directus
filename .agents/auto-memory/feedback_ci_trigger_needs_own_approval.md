---
name: feedback_ci_trigger_needs_own_approval
description: A label, dispatch, or rerun of a failure the diff may cause is its own approval — never implied by "merge once green"; a likely-flake rerun needs NO ask (public fork, free runners) unless runners are contended
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

**Exception — likely flakes (jean, 2026-11-02):** rerun a likely flake
(known-flake list, timing guard, runner error, code the diff does not touch)
at once, no ask. This fork is public, so runs are free; the only reason to
ask first is runner contention (`~/.agents/scripts/gha-contention.sh`, exit 1
= contended). Cross-repo rule: `~/.agents/feedback_rerun_likely_flaky_without_asking.md`.
On 2026-11-02 I still asked for a #367 concurrency-flake rerun on #667 because
this memory said "rerun is its own ask"; jean: "why once again don't you follow
the rule telling you can rerun on free/public repos when there is no contention?"

**How to apply:** treat label/dispatch, and a rerun of a failure the diff may
have caused, as needing explicit sign-off, same
tier as `git push` or opening a PR. An unanswered earlier offer is a "no," not
a standing yes to raise later. When multiple label scopes exist, propose the
narrowest one that would satisfy the ask, not the catch-all. See
[[feedback_ask_before_branch_switch_and_pr]] for the sibling rule on branch/PR
actions.
