---
name: reference_directus_bb_scenario_titles_in_test_file
description: A blackbox gherkin scenario renamed in its .feature must be renamed in the sibling .test.ts title list too, or the whole file fails with 0 tests
metadata:
  type: reference
---

Blackbox `.test.ts` files (e.g. `tests/db/routes/items/nested-o2m-array.test.ts`) list each scenario title as a string or `oneLine` template and loop `scenario(title, ...)`. Renaming, adding or splitting a `Scenario:` in the `.feature` without editing that list fails the WHOLE file at collection: `Scenario '<old title>' is in neither the feature's scenarios nor its scenario outlines` (common/cucumber.ts:175), reported as `(0 test)`.

The blackbox tsc and eslint gates don't catch it. Only CI does, because blackbox never runs locally ([[feedback_directus_bb_tests_in_ci]]).

**How to apply:** after any `Scenario:` edit, `git grep` the old title across `tests/blackbox` and update the `.test.ts` list before pushing (PR #614, 2026-11-01: cost one CI round).
