---
name: project_directus_typescript7_blocked
description: TypeScript 7.0.2 is a clean bump for this repo but typescript-eslint blocks it — its peer caps below 6.1 and TS 7 ships no compiler API, so pnpm lint dies at module load
metadata:
  type: project
---

Measured 2026-09-03, on a throwaway branch off hhh-dev.

**The bump itself is clean.** Catalog `typescript: 5.8.3 → 7.0.2`, install rc=0, and
the api tree reports **zero type errors** with no code changes. The shared
`@directus/tsconfig` is already TS 7-compatible (`target: ES2022`, `module: Node16`,
`strict: true`, none of the removed options — `es5`, `downlevelIteration`, `baseUrl`,
`moduleResolution: node`). No source of ours imports the TypeScript API.

**What blocks it: `typescript-eslint`.** Every published version, including
`8.69.0` latest and the `8.69.1-alpha.0` canary, declares
`peerDependencies.typescript: ">=4.8.4 <6.1.0"`. TS 7.0 deliberately ships **no
compiler API** (delayed to 7.1), so `pnpm lint` — a required check — dies at module
load, not on a rule:

```
TypeError: Cannot read properties of undefined (reading 'Cjs')
  at @typescript-eslint/typescript-estree/…/create-program/shared.js:59
```

19 unmet-peer warnings at install are the tell.

**Revisit trigger:** typescript-eslint publishing a peer range that admits
`typescript@7`. Nothing else needs to change.

**Note on what it buys:** the speed win is real on a *full project* check
(4.1s vs 21-24s) but invisible through `vitest --typecheck`, which checks a much
narrower set — see [[project_directus_vitest_typecheck_gate]] and
[[feedback_measure_the_same_invocation]]. `@typescript/native-preview` (`tsgo`) is
the coexistence route if the compiler is ever wanted before the tooling catches up.

Here `typescript-eslint` only parses — the config uses `configs.recommended`, not
`recommended-type-checked`, with no `projectService`. So no type-aware rule is lost;
what breaks is linting `.ts`/`.vue` at all.
