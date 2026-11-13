---
name: feedback_directus_gherkin_bb_conventions
description: how jean wants directus blackbox Gherkin (.feature + jest-cucumber fork) written — witness meaning, markers column, YAML query cells, step names that give the why, regression loop order
metadata:
  author: Jean Claveau
  type: feedback
---

Gherkin is the new bb standard (jest-cucumber fork `github:jclaveau/jest-cucumber#main-dist`). Existing bb tests are NOT edited: they are the consumer contract the refacto must keep green.

**Rules jean gave while reviewing the #531/#534 features:**
- **A "witness" is another row/read that must be touched or left alone depending on the action** (its cache is purged, or not, when the target row is read/updated/deleted). It is NOT the control read. He corrected my first meaning and had me drop everything I built on it.
- **`markers` column** names rows by intent: `target_1`, `target_2`, `witness_1`… and every assertion table lists the impacted rows in a `markers` column.
- **Query cell = one YAML object** (fields + filter merged), multiline cells, `owner: "xxx"` not `owner: {_eq: "xxx"}`, `fields` as a list, first array level not indented. Add `response` and `fingerprints` (purge fingerprints for mutations) columns. Keep the 3-column shape; soft 85 / hard 95 width. Indent JSON/YAML for clarity, line count is irrelevant. Plain simple arrays stay plain where there is no response/fingerprints to show. GraphQL: only pretty-print, never convert to YAML.
- **Step text says WHY**: not "the witness reads are purged" but "…are purged as their fingerprints have the same scope pins"; list the matching pins in the description, in real quotes (no backticks).
- **Regression loop order**: bb Gherkin scenario first (proves consumer contract), unit test only when bb cannot reach it, THEN fix; do it for every review finding, in a loop, in parallel. "To fix CI always privilege bb gherkin tests."
- Add a scenario per behaviour the PR claims ("is the consumer contract fully bb gherkin tested?" is asked at the end of every PR); a fix is only accepted with a comment in the feature pointing at the issue that will replace it.
- Never delete an assertion to make a test pass ("you propose to delete a test assertion as cleaner?"); poll `/server/ping` for readiness, not `/server/health`.
- Existing-test edits are allowed only for the rulings recorded in [[project_directus_issue531_composite_tags]] (over-purge assertions).

**Why:** the tables are read by jean as specs ([[feedback_spec_by_example_code_first]]); vague step names and metaphoric roles made him re-ask several times.

Related: [[reference_directus_gherkin_yaml_cells]], [[project_directus_bb_fixture_isolation]], [[feedback_regression_test_must_fail_without_fix]].
