---
name: feedback_directus_blackbox_gherkin_standard
description: Every NEW blackbox test file on this fork is Gherkin — a `.feature` next to the `.test.ts` (loadFeature/defineFeature), never a plain describe/it file
metadata:
  type: feedback
---

A new blackbox test is written as a `.feature` file plus its `.test.ts` step file
(`@common/cucumber`: `loadFeature`, `defineFeature`, `parseGherkinTable`), the way
`tests/db/routes/items/cache-declared-pin.test.ts` + `.feature` are. Plain
`describe`/`it` is legacy.

**Why:** jean, 2026-10-07, on PR #600 (#599 query-count headers): "you implemented bb
tests without feature file despite a memory telling it's THE new standard". I copied the
spawn/teardown pattern out of `cache-declared-pin.test.ts` and skipped its `.feature`
half. No memory stated the rule explicitly before this one; 18 of the last 24 new bb
files were Gherkin.

**How to apply:**
- Before writing a bb file, open a recent sibling's `.feature` and copy its shape, not
  only its spawn code.
- Step order must match every scenario ([[project_directus_blackbox_cucumber_step_order]]).
- Long table cells go multiline ([[feedback_feature_table_multiline_cells]]).
- Example literals live in the feature tables ([[feedback_spec_by_example_code_first]]).
