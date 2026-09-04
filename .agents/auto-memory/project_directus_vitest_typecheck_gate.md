---
name: project_directus_vitest_typecheck_gate
description: How the vitest typecheck gate behaves here — a per-file run hides the ambient error count, and it checks a far narrower set than a full tsc project run
metadata:
  type: project
---

`typecheck.enabled: true` in `api`, `sdk`, `packages/errors` vitest configs (PR #429).

**Run it unfiltered or the number is a lie.**

```bash
cd api && ./node_modules/.bin/vitest run --typecheck.only   # the count
cd api && ./node_modules/.bin/vitest run                    # + runtime, what CI runs
```

- `vitest run <file> --typecheck` prints `Type Errors  no errors` but **suppresses
  the ambient `Errors N` line**. A file that does not compile looks green. This hid a
  missing `Query` import until a full run.
- `Type Errors` = the `*.test-d.ts` assertions. `Errors` = everything `tsc` found in
  what those files reach. The second is the one that gates.

**Scope is much narrower than a project check.** Measured on api:

| | |
| --- | --- |
| `vitest --typecheck` | ~6.2s |
| `tsc -p tsconfig.json --noEmit` (same tsconfig) | 21-24s |

So the gate is not equivalent to a repo `tsc` step, and compiler-speed comparisons
made through it are dominated by its own scoping.

**The local environment has fooled me repeatedly** — stale `packages/*/dist` and a
worktree whose `node_modules` symlinks to the main tree both produce phantom errors
(89 → 56 after one rebuild; `constraint` and `pg` classes vanished entirely after a
real install). Do a real per-worktree `pnpm install --prefer-offline` (hardlinked,
cost ~0 disk here) and a workspace build before trusting a count.
Related: [[project_directus_worktree_shared_node_modules]], [[project_directus_local_gate_noise]].

**The gate disables itself if a package loses its last `*.test-d.ts`.** `typecheck.enabled`
runs tsc over whatever the type tests reach — over *nothing* in a package with none — and
vitest does not call that a failure. Measured on `packages/errors`, same deliberate type
error in `src/index.ts` both ways: **exit 1** with the type test collected, **exit 0**
printing `Type Errors no errors` without. Exposure: `packages/errors` has one such file,
`api` two, `sdk` four, and none reads as load-bearing.

`api/src/typecheck-gate.test.ts` pins it — walks the workspace layout (not a list), asserts
the gated set is non-empty so the per-package cases cannot pass vacuously, and fails by
package name. It lives in `src/` because vitest's default exclude carries
`**/{…,vitest,…}.config.*`: the obvious home, `api/vitest.config.test.ts`, was silently
never collected. See [[feedback_confirm_a_new_test_was_collected]].

**`tsc -p api --noEmit` is a clean instrument here** — 0 errors, ~23s. That makes it the
right tool for "is this cast/strip actually required": strip one thing, run it, read the
error. The vitest gate is not a substitute (far narrower set), and a per-file vitest run
hides the ambient `Errors N` line entirely.
