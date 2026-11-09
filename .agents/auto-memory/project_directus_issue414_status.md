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

Checked 2026-11-09: re-measure blocked, Planner `develop` lockfile pins dist `47146d370c` (built from Scalabus #673, already past #614 via Planner #844), older than every batching merge, so dev would measure the old code. Bump PR = Planner #848 (→ dist 06a95cca84, lockfile SHA+integrity only); dev = Railway auto-builds `develop`, so the re-measure waits on jean merging #848. Point 3 collapsed planner-side: the per-segment translations select came from `listDuplicates` reading `*`, which planner b9220704 (2026-10-18) narrowed to named fields. Point 4: planner `student_*` collections have `accountability: null`, so no activity/revisions there; the fork still runs one `directus_revisions` UPDATE (parent link) per created parent that has nested children (items.ts createMany revision loop). Permission checks run per row but `fetchPolicies`/`fetchRawPermissions` are `withCache`d, so no extra statements.

Guard written 2026-11-09: PR #711 `nested-write-scaling.feature` (O2M + M2M, 2 then 6 parents, scoped through parent, counts from CI's printed tables, head 9dcd90a7f6). Result: every count flat for 2 vs 6 parents EXCEPT `directus_revisions` update = one per created parent with nested children (2 vs 6), pinned as measured; batching it is a follow-up awaiting jean. Planner untouched by it (`accountability: null`).

**Why:** jean asked "what has not been done in 414" then said "go write the guard".
**How to apply:** guard = one blackbox scenario, same nested O2M write with 2 parents then 20, `scoped_cache_fields` set (block-style YAML), identical counts; worktree from hhh-dev. Don't claim #414 fixed without the re-measure. See [[project_directus_batched_plumbing_design]].
