---
name: project_scalabus_licensing
description: Scalabus fork licensing — fork additions are jean's own BSL-1.1 (Additional Use Grant None), NOT GPLv3; scope is repository-minus-upstream; PolyForm Shield or GPLv3 is a deliberate later decision
metadata:
  type: project
---

**`LICENSE.fork` = Business Source License 1.1, Licensor Jean Claveau, `Additional Use
Grant: None`, Change Date four years, Change License GPLv3.** Production use of the fork's
additions needs a grant from him, given on request. Upstream Directus stays under
Monospace's BSL-1.1 in `license`.

**Why:** the goal is defensive — deny a competitor of the planner the use of the
optimisations. GPLv3 (which `LICENSE.fork` briefly carried) is the wrong instrument: it
constrains *redistribution*, not *use*, and never triggers for a server app run as a
service, so it granted free production use of exactly what needed protecting.

**How to apply:**
- **Never scope the licence by branch name.** Jean: *"I want all my changes, whichever
  branch, to be jean claveau bsl"*. The Licensed Work is defined as every modification to
  Directus in this repository, "on any branch, tag, or distributed artifact", minus the
  upstream code. Branch names are mutable operational artifacts; the repository boundary
  is stable. Same rule applied to `readme.md`.
- **The grant field must read literally `None`** — BSL covenant 2 allows only a grant or
  that word, and covenant 4 forbids other edits. "Available on request" goes *below* the
  parameter block, the way Directus puts its pricing link there.
- **Licensor is Jean Claveau personally**, not an entity a partner could claim an interest
  in. And `license` is *Monospace's* BSL — never describe it as jean's; that would assert
  he licenses the Directus code.
- **Four years is the BSL ceiling** (it converts at the fourth anniversary regardless).
- **What he cannot revoke:** BSL binds derivative works, so upstream's <$5M production
  carve-out flows through to the Directus code. His own additions sit outside it.
- **`readme.md` records the intent to move to PolyForm Shield 1.0.0 (free except competing
  use) or GPLv3 once ready for real publication. Do not pre-empt that — it is a deliberate
  later decision.** Shield was researched and set aside, not rejected on merit.
- An LLM-assisted rewrite is not a clean-room reimplementation: the source goes in, so
  there is no wall, it preserves the arbitrary expressive choices that survive
  abstraction-filtration, and prompt logs are discoverable. The one-radical naming
  discipline ([[feedback_name_vocabulary_one_radical]]) is therefore a provenance asset.

History was rewritten 2026-08-06 to remove the GPLv3 episode — see
[[reference_git_history_rewrite]] and [[project_scalabus_derived_branches]].
