---
name: project_directus_scoped_cache_patch_coverage_parked
description: RESOLVED 2026-07-01 — PR #205 codecov/patch driven to ~99% in-branch (target bumped 90→95); no longer parked
metadata:
  type: project
---

**RESOLVED 2026-07-01 (no longer parked).** The gap was closed IN #205, not a separate PR: a
subagent test-writing campaign took `codecov/patch` from ~40% → **98–99%** and the blocking
`patch.default.target` was bumped `auto`→90→**95%** in `codecov.yaml`. Key realizations that made it
tractable: (1) most of the "gap" was **reformatting inflation** — verticalization split 1 uncovered
pre-existing line into N added lines ([[reference_reformatting_inflates_patch_coverage]]); (2) the real
union-missed lines concentrated in `controllers/items.ts` (brace-reformatted directus controller
branches blackbox can't reach — tsc stack), covered by a router.stack unit test; (3) the codecov v2
commit-report API DOES give per-line misses ([[reference_codecov_patch_coverage]]) — no guessing. The
merged tests were later renamed off the `*.coverage.*` convention ([[feedback_no_coverage_in_test_names]]).
Historical detail of the original gap kept below.

---

#205 (scoped-cache value tags) leaves `codecov/patch` RED — 40.56%, ~62 uncovered PRODUCT lines in
the diff — PARKED for a dedicated test-only PR (user, 2026-06-29).

- **Not the style work.** The eslint-gate / ≤90-wrap / multiline-ternary commits are
  coverage-neutral: every ternary/`??` arm they split was already unit-covered, except updateMany's
  `oldScopedCacheTags === null ? null : [...]` (the `? null` line) which got its own test in commit
  `f44042e058`. Style tooling (`eslint-rules/`, `scripts/lint-style-changes.mjs`) is codecov-ignored
  (commit `32cf203375`); `eslint.style.config.js` falls under the `*.config.js` ignore.
- **The ~62 are pre-existing #205 feature gaps** — covered by neither the unit flag nor blackbox
  (the `blackbox` flag patch is also 40.56%):
  - `api/src/services/items.ts` mutation paths (createMany / updateMany / updateBatch / deleteMany
    scoped-cache branches) = the bulk. Unit-testable via the `knex-mock-client` harness in
    `scoped-cache-purge.test.ts` — `tracker.on.select/update/insert/delete('test').response(...)` to
    drive each branch (see the null-snapshot test added in `f44042e058` as the template).
  - `updateBatch` ternary `oldScopedCacheTags === null || newScopedCacheTags === null ? null : [...]`
    — a known untested arm (was already multiline in #205, so not exposed by the style work).
  - `api/src/utils/get-schema.ts` JSON-meta normalizer (incl. the `: []` non-array arm) — ~8.7% unit
    (integration-only); needs a knex-mock unit harness or accept as blackbox-domain.
- **Why safe to park:** `codecov/patch` is required only on `v11.10.1-prepare`; #205's base is
  `v11.10.1-hhh-dev` and feat PRs are never merged ([[project_directus_fork_integration_branches]]),
  so the red is cosmetic. To get the EXACT missing lines (codecov UI hides them): run the full api
  unit + blackbox coverage and intersect with the diff's added lines — mechanics in
  [[reference_codecov_patch_coverage]] / [[project_directus_codecov_flags]].

Builds on [[project_directus_scoped_cache_design]].
