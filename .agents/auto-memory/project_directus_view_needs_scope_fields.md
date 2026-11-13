---
name: project_directus_view_needs_scope_fields
description: A cached read's view only keeps it warm on a collection with scoped_cache_fields; without them every update touches every field
metadata:
  type: project
---

A collection with NO `scoped_cache_fields` skips the row read-back in `snapshot()` (item-scoped-cache-service.ts, "A collection scoping on nothing"): rows carry `row: null`, so `changed` covers every field and every update purges every read of it, whatever its `view=`.

**Why:** the #534 restated-pin blackbox test passed with its fix reverted (2026-09-28) because its collections declared no scope fields — the view gate never ran.

**How to apply:** any bb test proving a write LEAVES a read cached (view / changed-field narrowing) must give its collection `meta: { scoped_cache_fields: [...] }`. Related: [[project_directus_bb_fixture_isolation]], [[feedback_regression_test_must_fail_without_fix]].
