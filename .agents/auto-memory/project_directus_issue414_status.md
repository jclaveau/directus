---
name: project_directus_issue414_status
description: Issue #414 (registration write statement count) status 2026-11-09 — what shipped per PR, what is left (re-measure, scaling CI guard), body rewritten
metadata:
  author: Jean Claveau
  type: project
---

#414 body rewritten 2026-11-09: status on top, original report folded below.

Shipped: #358 top-level createMany one INSERT; #387 one update event per update; #424 scope paths in one query; #675 (A) upsertMany; #685 (B) processO2M fan-in, no deselect query on pure create; #686 nested M2O/A2O; #691 `mutationBatching`. Open follow-ups #707, #710.

Left: (1) re-measure with `pg_stat_statements` on the 3-student EDN registration (closing condition, needs dev env, writes data, not run); (2) junction duplicate check is planner-side, should have collapsed with (B); (3) `student_schedule_segment_translations` 1,812 lookups/student is planner-side, table empty and slated for drop; (4) three open questions (batch permissions/validation, revisions+activity per-row inserts, one long transaction's locks).

CI gap: ~30 blackbox `.feature` files pin statement counts but only on 2-3 parents; none checks flat count as parents grow, none with `scoped_cache_fields` on nested O2M; `bench.yml` has no write bench.

Guard written 2026-11-09: PR #711 `nested-write-scaling.feature` (O2M + M2M, 2 then 6 parents, scoped through parent, placeholder counts filled from CI's printed tables).

**Why:** jean asked "what has not been done in 414" then said "go write the guard".
**How to apply:** guard = one blackbox scenario, same nested O2M write with 2 parents then 20, `scoped_cache_fields` set (block-style YAML), identical counts; worktree from hhh-dev. Don't claim #414 fixed without the re-measure. See [[project_directus_batched_plumbing_design]].
