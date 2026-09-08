---
name: project_directus_pr429_accepted_exceptions
description: PR #429 (run the type tests, gate on the types they reach) — MERGED 6dc12247b6; settled points a fresh review would wrongly re-flag
metadata:
  type: project
---

`v11.10.1-test/vitest-typecheck`. Turns on `typecheck.enabled` for `api`, `sdk` and
`packages/errors` — no package had it, so seven `*.test-d.ts` files had never run.
144 type errors → 0.

**Settled — do NOT re-raise:**

- **`WithMeta` stays in the read signatures.** I removed it, argued nothing consumed
  the type; jean pointed out that was circular (`readMeta` took `unknown`). Reversed
  — "B in this PR". `withMeta()` is the last thing `readByQuery` does, *after* the
  read hooks, so the rider is genuinely on every read result. See
  [[project_directus_read_meta_rider]].
- **`exactOptionalPropertyTypes` stays on.** From `@directus/tsconfig` base; `app`
  already opts out. Disabling it for api **costs 13 errors**, does not save any —
  inferred object literals widen and assignability gets worse.
- **`isPrimaryKey` is deliberately not schema-aware** — impossible at the type level
  (`SchemaOverview.primary` is a runtime `string`, `AnyItem` is `Record<string,any>`).
  Filed as **#430**, linked in the description. The schema check is `validateKeys`.
- **Two `as` remain, both irreducible**: `ioredis`'s `Redis` (7 constructor overloads
  → `ConstructorParameters` = `[]`). Everything else was fixed at the source.
- **`typescript@7` is out of scope** — see [[project_directus_typescript7_blocked]].

**Known-noisy, not this PR's:** three files fail only in the full 282-file parallel
run and pass 34/34 together (unrestored spies leaking); `get-address.test.ts` leaves
`/tmp/server-test.sock` so the *next* run trips `EADDRINUSE`. CI has a different
flake surface — `wait-for-message.test.ts` failed there and passes locally 3/3.

## Settled in the second review round (all MERGED as `6dc12247b6`)

- **Every `as X` on a read result is required.** Nine of them; six predate this PR. Each was
  measured by removing it: TS2322 / TS2739 / TS2740 / TS2345, and `collections.ts` alone
  turns into nine errors. `withoutMeta` beside them is load-bearing too — removing only the
  strip gives eight identical TS2352. Do not re-raise "why the cast"; the answer and the
  numbers are in the PR threads and #431.
- **`versions.ts`'s `as ContentVersion` is kept although the file compiles without it** —
  destructuring off `Record<string, any>` succeeds and silently types `collection`, `item`
  and `delta` as `any` into `validateAccess` and `updateOne`.
- **`MaybeWithMeta` is deliberate, cost included** — it disables the weak-type check for
  every read result against any target adopting it. Signed off for `userName`, which is
  genuinely shape-agnostic. Not a licence to spread it.
- **`userName` keeps `Partial<User>`** — a `PartialWith<User, 'email'>`-style union was
  considered and measured: it rejects `{ id }` (a real win) but accepts `{ email: null }`,
  and the NonNullable version rejects `WithMeta<User>` itself, since every name field on
  `User` is `string | null`. The `'Unknown User'` fallback is correct, not sloppy.
- **`shares.ts` ends byte-identical to base** — the `senderName` const was only ever there
  to keep a `withoutMeta(...)` call out of a template literal.
- **The knex internal is two named types, not four helpers** — `KnexWithSettings` /
  `KnexWithConnectionString` in `get-database-for-accountability.test.ts`. The union type
  was what forced the `typeof connection === 'string'` ternary into three of the four
  helpers. The nine resulting `no-single-use-const` warnings are accepted: the const
  carries the cast, and inlining rebuilds the `expect(` pyramid.
- **Deep review (max) findings are closed**: the typecheck-gate guard test landed, the
  `shares.test.ts` spy now restores, and the cache-anomaly url/query mismatch is **#432**
  (out of scope — telemetry, not the type gate). #430 and #431 are the other follow-ups.
