---
name: project_directus_utils_barrel_cost
description: @directus/utils ships as ONE bundle (36 MB / 344 ms), so @directus/env paid it to read four helpers — @directus/utils/values is the narrow entry; /node is still unnarrowed at 15 MB
metadata:
  author: Jean Claveau
  type: project
---

`@directus/utils` builds with tsdown into a single `dist/shared/index.js`, so
there is **no deep import**: naming the package loads joi, date-fns,
micromustache and the system-data tables whatever was asked for. Measured, one
dynamic import into an otherwise empty node 22.22 process, RSS over a 41 MB
baseline:

| module | RSS | time |
| --- | --- | --- |
| `@directus/utils` (shared barrel) | 77 MB | 344 ms |
| `@directus/utils/node` | 56 MB | 67 ms |
| `@directus/utils/values` | 42 MB | 1 ms |
| joi | 55 MB | 63 ms |
| micromustache | 47 MB | 6 ms |
| js-yaml | 50 MB | 25 ms |
| fs-extra | 54 MB | 37 ms |

`@directus/env` asked the barrel for `isIn`, `parseJSON`, `toArray`,
`toBoolean`, in **every process of every deployment**. A/B on the built package,
variable verified in the artifact:

| @directus/env | RSS | time |
| --- | --- | --- |
| barrel | 88 MB | 345 ms |
| `@directus/utils/values` | 58 MB | 73 ms |

**`@directus/utils/values`** (`packages/utils/shared/values/index.ts`, its own
tsdown entry + `exports` map entry) gathers the modules that import nothing of
their own. The shared barrel still re-exports all of them, so no other consumer
moves. An eslint block scoped to `packages/env/**` bans the bare package —
repeating the lodash-es/date-fns bans, because a flat config **replaces** a rule
rather than adding to it. PR #492, issue #489.

**Still open:** `@directus/utils/node` is 15 MB and `@directus/env` imports it
statically for `requireYaml`, which is synchronous and reached synchronously —
so it cannot become a lazy import. fs-extra (13 MB) comes from the barrel's
`tmp`/`list-folders`, not from anything env calls, so a narrow node entry would
recover most of it.

`vue` in `packages/utils/shared/is-vue-component.ts` is a **type-only** import
and costs nothing at runtime — do not re-report it.

See [[project_directus_barrel_import_shapes]] for the `*-used.ts` pattern this
extends, and [[project_directus_eager_module_imports]] for the other eager
chains.
