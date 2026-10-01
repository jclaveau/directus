---
name: reference_eslint_restricted_imports_static_only
description: no-restricted-imports only sees static imports, so a package pin needs no-restricted-syntax to cover require() and dynamic import()
metadata:
  type: reference
---

`no-restricted-imports` (and its `@typescript-eslint` variant) matches **only a
static `import … from '<pkg>'`**. Both of these lint clean under a `paths` entry
for the package:

```js
const require = createRequire(import.meta.url);
require('isolated-vm');
await import('isolated-vm');
```

That is the whole point of a lazy-loading pin, so the rule alone does not enforce
it — and the `createRequire` form is exactly what the exec operation used before
#465. Cover the other two shapes with `no-restricted-syntax` in the same config
block, so the block's `ignores` list keeps exempting the loaders:

```js
{ selector: "ImportExpression[source.value='sharp']", message: … },
{ selector: "CallExpression[callee.name='require'][arguments.0.value='sharp']", message: … },
```

Live in `eslint.config.js` for `sharp` and `isolated-vm` ([[project_directus_sharp_libvips_memory]]).

**Why:** before this, the two `ignores` entries were dead config — nothing in
either loader would have tripped the rule anyway, since a loader uses a dynamic
import and its `typeof import(…)` type is allowed by `allowTypeImports`.

**How to apply:** after writing any import pin, mutation-test it — write a probe
file with all three shapes, lint it, and confirm the count. Then copy the exempt
file to a non-ignored path and confirm it *now* errors; if it doesn't, the
exemption is decorative and the rule isn't holding anything.
