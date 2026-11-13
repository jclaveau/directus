---
name: project_directus_core_extensions_package_traps
description: New workspace package under packages/core-extensions/* — CI-only traps (undeclared @directus/utils dep, subagent-written unverified tests, Stylelint "Empty source" #681, CI proof-red via a pushed mutant branch)
metadata:
  author: Jean Claveau
  type: project
---

`packages/core-extensions/*` (added to `pnpm-workspace.yaml` by #680) is the home of first-party bundles (`@scalabus/subscriptions` first). The recursive unit job picks each package up; coverage uploads under its own flag.

**Traps hit on #680 (tests run only in CI):**
- A package test importing `@directus/utils` (`oneLine`) without declaring it → 3 test files fail to import in "Unit Tests (rest)"; declare as devDependency + refresh `pnpm-lock.yaml`.
- Adding `sqlite3` as a package devDependency drops `optional: true` from part of the lockfile (expected churn).
- A subagent that cannot run vitest/tsc writes unverified tests: expect red CI on mounting/types and iterate; its report lists "guesses" — read them first.
- `Stylelint` job failed "Empty source" when no CSS file changed (no file args → stdin); fixed separately in #681, predates the bundle — don't blame the PR.
- Proof a regression test is red without its fix, with no local vitest: push a throwaway `tmp/<pr>-mutant` branch with the fix reverted, read its CI, delete the branch. Derive its sha with a guarded `git rev-parse` (an empty result concatenated the branch name into the API URL).
