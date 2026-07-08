---
name: reference_directus_worktree_vitest_barrel
description: vitest in a git-worktree with symlinked node_modules can't resolve stream-json's ESM subpath via the services barrel — mock the barrel-reaching import or import the concrete module
metadata:
  type: reference
---

In a `git worktree` whose `node_modules` are **symlinked** from the main tree, vitest/vite fails to
resolve some deps' ESM **subpath** exports — concretely `stream-json/streamers/stream-array.js`
imported by `api/src/services/import-export.ts`. Any test whose import graph reaches the services
**barrel** (`api/src/services/index.js`) pulls `import-export.ts` → fails at **collect** time
(`Failed to load url stream-json/streamers/stream-array.js`), before any test runs.

**Why:** vite resolves the symlink realpath and loses the worktree's node_modules context for the
subpath; `stream-json` is installed but unreachable that way. Confirmed: the UNMODIFIED
`users.test.ts` fails identically → it's the env, not your change.

**How to apply:**
- Tests that import a service **directly** (`./items.js`) instead of the barrel work fine — that's
  why `items-cache-tags.test.ts` runs but `items.test.ts` (imports `./index.js`) doesn't.
- To run a barrel-reaching unit (e.g. `GraphQLService`) in a worktree, **mock the module that pulls
  the chain**: `vi.mock('./schema/index.js', () => ({ generateSchema: vi.fn() }))` and
  `vi.mock('../../utils/get-service.js', …)` cut the path to `import-export.ts`.
- Symlink setup that otherwise works: `ln -sfn <main>/node_modules <wt>/node_modules` (+ `/api`,
  `/packages/types`). Full-suite barrel tests still need a real `pnpm install` or the main tree.
- **`tsc` is noise in a symlinked-node_modules worktree.** `@directus/*` resolves to the **built dist**
  carried by the main tree's node_modules — stale vs the worktree's `packages/*/src`. Editing a
  package's source (e.g. adding `ScopedCacheTag` to `@directus/types`) → `tsc --noEmit` reports
  `TS2305 no exported member` / `Property … does not exist` on the NEW symbols, plus fork features
  (`awaitActionHooks`) the stale dist lacks. **Env false-positives, not your bug** — runtime vitest
  (types erased) passes, CI builds packages first. To really typecheck, `pnpm --filter @directus/types
  build` first (disk/install cost) or rely on CI.
- Related: [[reference_agent_worktree_no_node_modules]], [[local_vitest_env_constrained]].
