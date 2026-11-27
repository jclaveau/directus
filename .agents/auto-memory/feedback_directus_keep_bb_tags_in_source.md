---
name: feedback_directus_keep_bb_tags_in_source
description: jean prefers the in-source `// bb-out-of-scope:` / `// bb-unit-only:` tags; never propose moving them to a side list (option "D") again
metadata:
  type: feedback
---

The branch audit's tags stay as comments on the upstream lines they cover. Do not
propose moving them into a JSON list beside the audit, even when they redden
codecov/patch or CodeQL.

**Why:** jean said on 2026-11-26, after D was proposed several times for PR #769:
"stop proposing D plz I prefer the tag approach".

**How to apply:** for a codecov/patch gap caused by tags, look at other levers:
strip the tagged ranges from the codecov upload (the one jean picked, see
[[project_directus_codecov_aggregate_patch_gate]]), cover the line in blackbox and
drop its tag, ignore whole dead files in codecov.yaml, or remove the dead code.
Related: [[project_directus_bb_branch_audit]].
