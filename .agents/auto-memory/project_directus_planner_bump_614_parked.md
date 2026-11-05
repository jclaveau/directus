---
name: project_directus_planner_bump_614_parked
description: The planner bump past #614 must carry the parked description (migration deploy hold + REST 404/batch-delete/system-POST changes), all ruled on purpose by jean
metadata:
  type: project
---

On 2026-11-01 jean ruled the #614 deploy and contract consequences "on purpose": the two duplicate-refusing migrations hold the deploy at health 503, and the admin 404 / batch DELETE 404 / system-collection array POST checks stay. They are parked for the planner bump PR, not fixed in the fork.

The paste-ready text is at `.agents/parked/planner-bump-scalabus-614.md`.

**Why:** the planner must adapt to these changes. A fresh review must not re-raise them as fork defects.

**How to apply:** when opening the planner PR that bumps the fork past #614, paste that section into its description and work its checklist. See [[project_planner_directus_dist_pin]] and [[project_directus_planner_deploy_shape]].
