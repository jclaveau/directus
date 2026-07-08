---
name: reference_rolldown_110_define_moved
description: rolldown 1.1.x moved the top-level `define` config option under `transform.define`; rc.x→1.1 bumps break extensions-sdk build.ts with TS2769
metadata:
  type: reference
---

rolldown **1.1.x** relocated the bundler `define` option: it is no longer a top-level config field (`ConfigExport`/`InputOptions`), it lives under **`transform.define`** (`TransformOptions`).

Symptom after bumping rolldown rc.16 → 1.1.3 in the v11.10.1 chain: `packages/extensions-sdk` build (`tsc --project tsconfig.prod.json`) fails CI with:
`src/cli/commands/build.ts: error TS2769: No overload matches this call. ... 'define' does not exist in type 'ConfigExport'.`

Fix in `packages/extensions-sdk/src/cli/commands/build.ts` defineConfig():
```ts
// before (rc.16):
define: mode === 'browser' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
// after (1.1.x):
transform: mode === 'browser' ? { define: { 'process.env.NODE_ENV': JSON.stringify('production') } } : {},
```
rolldown's own type doc shows the new shape: `transform: { define: { 'process.env.NODE_ENV': "'production'" } }`.

How this was caught/fixed: local repro in a worktree (`pnpm install --frozen-lockfile --prefer-offline`, build deps with `pnpm --filter "@directus/extensions-sdk^..." build`, then run the exact failing `tsc`) — the version-anchored env, not CI ping-pong (see [[local_vitest_env_constrained]]). The `define` patch is the "only pin browser extensions to production" change (see [[feedback_push_dialect_logic_to_helpers]]-style upstream-parity work); built-in minifier still alpha so `terser()` stays.
