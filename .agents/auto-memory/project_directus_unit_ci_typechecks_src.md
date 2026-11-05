---
name: project_directus_unit_ci_typechecks_src
description: CI "Unit Tests (api)" fails on a src type error that local `vitest --changed` reports as "Type Errors no errors"; run tsc filtered to touched files before push
metadata:
  type: project
---

CI's `Unit Tests (api)` job fails on a TypeCheckError in `api/src` (seen 2026-10-18, PR #614, `items.ts:2709` TS2322) even when every test passes. Locally `vitest run --changed` printed `Type Errors  no errors` over the same tree: its typecheck does not cover the source files.

**Why:** a pushed commit went red on a cast only tsc saw; cost a CI round.

**How to apply:** before pushing api source changes, `cd api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/<touched files>'` (whole-project tsc has pre-existing debt, see [[reference_api_typecheck_blocked]]; filter, don't read the total).

**Also test files (2026-10-24, #625):** api `tsconfig.json` includes all of `src`, so tsc
DOES type-check `*.test.ts` — but filtering its output to the touched SOURCE files
hides a test-file TS2353 that CI's unit job then fails on. Filter on every touched
`api/src` path, tests included.
