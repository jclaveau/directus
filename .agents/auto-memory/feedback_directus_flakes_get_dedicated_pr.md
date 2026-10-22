---
name: feedback_directus_flakes_get_dedicated_pr
description: When a feature PR hits an unrelated CI flake, jean wants the rerun AND a root-cause fix in a dedicated PR merged BEFORE the feature PR, in parallel
metadata:
  author: Jean Claveau
  type: feedback
---

On a flaky red in a feature PR (#387), jean answered the rerun ask with "rerun and in parallel fix them both in a dedicated pr to merge before". Rerun the failed shard, and spawn an agent on a new branch off `v11.10.1-hhh-dev` (`v11.10.1-fix/blackbox-and-app-flakes` → PR #602), root-cause not retry.

**Why:** a flake left in place keeps the feature PR red; a retry hides it (the #590 retry never fired over websocket).
**How to apply:** prove red-then-green locally when reproducible (force the delay); say plainly when the only proof is CI. Never merge either PR without a per-PR ask ([[feedback_ci_trigger_needs_own_approval]]). Details: [[project_directus_blackbox_flakes]].
