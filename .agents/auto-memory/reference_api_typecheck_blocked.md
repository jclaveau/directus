---
name: reference_api_typecheck_blocked
description: Why vitest typecheck (*.test-d.ts) can't be turned on in the api package without a cleanup PR
metadata:
  type: reference
---

The `api` package's `*.test-d.ts` type assertions (e.g. `api/src/emitter.test-d.ts`) are collected by vitest but NEVER
executed — `api/vitest.config.ts` has no `typecheck` block.

Enabling `typecheck: { enabled: true }` is blocked by pre-existing type debt:

- Package-wide it surfaces **~203 type errors** across `api/src` (vitest runs `tsc` over the whole tsconfig
  `include: ["src"]`, not just the test-d file). Example: `src/websocket/errors.test.ts` zod `$ZodIssue` shape mismatch.
- Even scoping via a custom `typecheck.tsconfig` that includes only `src/emitter.ts` + `src/emitter.test-d.ts` still
  fails: `emitter.ts` → `logger/index.ts` imports `pino-http-print`, which ships **no type declarations** → implicit-any
  error under the strict base config (`@directus/tsconfig/node22`).

So wiring up vitest typecheck needs a dedicated type-cleanup PR (ambient `declare module 'pino-http-print'`, fix the
~203 errors), not a coverage change. Until then, type-level tests are documentation only. Seen while covering PR #59
(typed FilterHandler).
