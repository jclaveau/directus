---
name: project_directus_issue414_status
description: Issue #414 (statement count of a batched registration write) — fork PRs shipped, the sameRowAs dedup design (S4 + refuseSameRowNamingAnotherKey), the 2026-11-13 re-measure verdict, and what is still left
metadata:
  author: Jean Claveau
  type: project
---

#414 = a consumer's registration write (one student × 844 courses) explodes into tens of thousands of statements. Body rewritten 2026-11-09: status on top, original report folded below. The consumer-side history lives in the consumer's repo.

**Shipped on the fork:** #358 top-level createMany one INSERT; #387 one update event per update; #424 scope paths in one query; #675 upsertMany; #685 processO2M fan-in, no deselect query on pure create; #686 nested M2O/A2O; #691 `mutationBatching`; #707, #710; #711 + #713 `nested-write-scaling.feature` guard (2 / 6 / 20 parents, counts flat); #712 revisions parent-link in one `updateGroups`; #714 write bench gating every trunk push on count growth; #715 upsertMany skips read-back + purge of an inert takeover (jean: KEEP the purge skip, don't re-raise); #717 all-create rows nesting a flat keyless M2O record no longer run alone in `upsertRunsOf`; #719 + #721 + #723 dedup scenarios and their count tables; #725 request store; #731 key-only nested records batched in one upsert run.

**Dedup design (S4, jean 2026-11-10):** once nested rows batch, a hook that refused a repeated nested record (RecordNotUniqueError) fires on every registration. The hook now answers `{ sameRowAs: firstIndex }` for a repeated row whose fields are all identical (items.ts `results[index] = results[sameRowAs]`; name kept, the pointed entry may be `{data}`, `{key}` or null), and still refuses a differing one (400). `createMany` refuses (400, `refuseSameRowNamingAnotherKey`) a `sameRowAs` answer whose row carries its own key different from its target's key (compared via `primaryKeyNameOf`); a hook-cancelled target keeps its payload key in the message ("…row 0 the key 1, cancelled by a hook"). A native opt-in upsert-on-unique-index option waits on #620.

**Test lessons:** sqlite inserts keyed rows one by one, so a batch-vs-split hazard is invisible there: guards must use keyless (autoincrement) rows, with columns aligned (`b: null`) to force one multi-row insert, and each guard mutation-tested. A key-only nested record mixed with a keyless one in one run collides on the sequence under `minimizeMutations` → the run is split (#731).

**Re-measure 2026-11-13** on a consumer's dev, 3 students × 844 courses, after the consumer adopted `sameRowAs`: junction inserts 1,688 → 4 per student, path resolution 8,440 → ~814 (whole run), 41,207 → 8,383 statements, the proposed-courses step 74-81 s → 7.0-7.3 s. Verdict: fixed; closing comment drafted (its ~814 line contradicted itself, fix before posting), post + close awaits jean.

**Still left:** update payloads nesting keyless records still insert one record per group; open questions on per-row permission/validation, revisions + activity per-row inserts, one long transaction's locks (FK KEY SHARE and unique waits measured harmless; only a shared-row UPDATE would queue).

**Why:** jean asked "what has not been done in 414", then "go write the guard"; #717's goal is avoiding query explosions, so dedup tests COUNT statements.
**How to apply:** guard = one blackbox scenario, same nested write with 2 parents then 20, `scoped_cache_fields` set (block-style YAML), identical counts; worktree from hhh-dev. Don't claim a count drop without a measure. See [[project_directus_batched_plumbing_design]], [[project_directus_pr686_batched_m2o_a2o]].
