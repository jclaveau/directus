---
name: project_directus_unbounded_spread_397
description: Issue #397 — spreading a data-sized array into a call throws RangeError; 58 sites in api/src incl. savedKeys.push(...keys) in 17 controllers, unbounded because MAX_BATCH_MUTATION defaults to Infinity
metadata:
  type: project
---

**#397.** `f(...arr)` makes every element a call argument, so a runtime-sized array
blows the stack. Found while fixing one instance in #393.

**The live one:** `api/src/controllers/items.ts:41`
`savedKeys.push(...keys.filter(...))` — one key per created row, and
`packages/env/src/constants/defaults.ts:15` sets `MAX_BATCH_MUTATION: Infinity`. A big
enough `POST /items/<collection>` **writes every row, commits, then throws on the way
out** — a 500 for a mutation that succeeded. Same three lines in **17 controllers**:
access, comments, dashboards, flows, folders, items, notifications, operations, panels,
permissions, policies, presets, roles, shares, translations, users, versions.

**Measured caps** (node v22.22.0) — a stack-size property, so it moves with context:

| context | largest OK | throws |
|---|---|---|
| main thread | 125 000 | 200 000 |
| vitest worker | 400 000 | 800 000 |

That is why no unit test can pin it: any N means something different in the two places.

**Scope:** 58 non-test sites in `api/src` spreading into `push`/`unshift`/`del`
(76 counting every `f(...args)`; plain forwarding is legitimate, which is the gap).
Biggest: `services/items.ts` 11, `services/fields.ts` 4.

**Proposed:** convert the unbounded ones to a loop, then a `local/no-spread-into-variadic`
rule keyed on a curated sink list. Conversions first — they are the part that fixes a bug.

Related: [[reference_ioredis_array_args_vs_spread]], [[project_directus_pr393_accepted_exceptions]].
