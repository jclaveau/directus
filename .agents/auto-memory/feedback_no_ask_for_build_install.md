---
name: feedback-no-ask-for-build-install-in-pr-flow
description:
  In the Directus PR-flow context on this fork, do NOT ask before running pnpm install / pnpm build / workspace builds.
  The global ask-before-install rule is overridden here.
metadata:
  type: feedback
---

For this repo's upstream-bound PR work, `pnpm install`, `pnpm --filter <pkg> build`, and `pnpm -r build` should be run
without first asking. The friction of asking every time outweighs the safety win when the build/install steps are
routine prerequisites to running tests.

**Why:** User feedback explicit in this session: _"do not ask for building any package nor calling pnpm install"_. The
global default ([[feedback-ask-before-build-install]]) still applies in other contexts; this is a project-scoped
override.

**How to apply:**

- `pnpm install` (after pulling, after adding/removing deps): run without asking.
- `pnpm --filter <pkg> build` (for a single workspace package): run without asking.
- `pnpm -r build` / `pnpm -r --filter '@directus/*' build` (workspace-wide): run without asking.
- The exception: anything that _modifies_ dependencies (e.g. `pnpm add`, `pnpm update`, `pnpm remove`) still requires
  explicit user confirmation. The override is for build/install steps that are reproducing a known state, not for
  changing dependency versions.
- Docker builds (`docker compose build`, `docker build`) still ask per the global rule — they're slower and
  side-effecty.
