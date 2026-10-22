---
name: feedback_no_legacy_comments
description: Never write comments that speak about a legacy/outdated/removed need or contrast against a past state — code should say what's true now, straight to the point
metadata:
  type: feedback
---

Jean, verbatim: "never add comments just speaking about legacy / outdated needs. The
code should go straight to the point."

**Why:** a comment justified by history rots the moment the history stops mattering, and
reads as a monument to a deletion rather than information about the code that's there.
Example caught in [[project_pr753_pre_node_env_wrapper]]/#753: a comment explaining
*"--experimental-require-module is deliberately NOT here…"* and another contrasting a
new cooldown value against *"the base env file's 10 is what dev used to inherit"* — both
past-tense justifications for an absence, not statements about what's present.

**Tell to grep/self-check for:** a comparative or past tense — *used to*, *no longer*,
*previously*, *rather than the old*, *kept because*, *deliberately not*. If the sentence
needs one of those to make sense, the reasoning belongs in the commit message, not the
comment. When a legacy-framed comment holds one live fact worth keeping, keep only the
forward half restated as a present-tense reason (e.g. "This replaces node_args rather
than adding to it, so a flag that has to hold for every run belongs in NODE_OPTIONS" —
true regardless of history).

**Exception:** a comment justifying *why a value that's actually there is what it is*
(a measurement, a trade-off between two configs that are both currently live) is not a
legacy comment — e.g. "release stays at 10 rather than prod's 40" contrasts two live
configs a reader of that file genuinely needs, and stays.

**How to apply:** after any edit that removes or replaces behavior, grep the touched
files for the tell-words above before considering the change done — a first pass often
misses instances the rule would also catch (5 blocks found on a second sweep after 3
were reported).
