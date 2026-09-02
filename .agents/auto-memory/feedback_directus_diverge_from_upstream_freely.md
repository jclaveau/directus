---
name: feedback_directus_diverge_from_upstream_freely
description: On this fork, "it would diverge from a pristine upstream file" is NOT a reason to decline a fix — jean does not care about upstream merge friction
metadata:
  type: feedback
---

Stated outright 2026-08-19: _"there is a memory telling you we don't care about
diverging from upstream so plz test the fix then apply your fix"_.

I had declined a nit — declaring `meta` on `Query` in `packages/types` — because that
file and `api/src/utils/sanitize-query.ts` were byte-identical to upstream, citing
AGENTS.md's "keep diffs minimal versus upstream". Wrong call: that line is about not
reformatting untouched lines (which is why the style gate is added-lines-only), not
about refusing a correctness or clarity fix.

**Why:** the fork is a permanent divergence with its own release line; merge friction
on two lines is not a cost worth trading a real fix for.

**How to apply:** weigh a change on its merits. Reserve "leave it" for hunks upstream
already solved equivalently ([[feedback_extract_keep_all_but_upstream_equiv]]).
Still do NOT reformat untouched upstream lines — that rule stands.
