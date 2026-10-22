---
name: project_directus_barrel_import_shapes
description: lodash-es and date-fns want opposite deep-import shapes, and each package gathers what it uses in a *-used.ts
metadata:
  author: Jean Claveau
  type: project
---

Naming a package resolves all of it: `lodash-es` is 640 modules, `date-fns` 304. The
fork imports per function instead, and the two packages are **not** interchangeable:

- `lodash-es` exposes `./merge.js` — extension required, **default** export.
- `date-fns` exposes `./format` — extensionless via its `exports` map
  (`date-fns/format.js` does not resolve), and while `format.js` carries
  `export default`, its `.d.ts` declares only the **named** export. A default import
  runs perfectly and fails typecheck. That is what turned #435 red on its first push.

`lodash-es` ships no typings at all; they come from `@types/lodash-es` (already a
`catalog:` dep in 8 workspace packages), which has per-function `.d.ts` files, so the
deep specifiers keep real inferred types — verified with a probe, not assumed.

Each package gathers what it calls in `lodash-es-used.ts` / `date-fns-used.ts` and
imports from there; `no-restricted-imports` bans both the package and its subpaths
everywhere but those modules. Gathering costs +2 modules and ~20 fewer `resolve()`
calls — inside the noise, so it was jean's design call, not a perf one.

Measured: 5004 → 4369 modules. `date-fns` drops 304 → 56; **`lodash-es` only halves,
640 → 251**, because its per-function files share a deep internal helper graph. Do not
expect the same ratio from a similar sweep.

`themes` and `composables` are deliberately untouched — app-only, so they cost the API
nothing, and Vite already tree-shakes barrels at build time.
