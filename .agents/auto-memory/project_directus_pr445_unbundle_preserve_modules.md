---
name: project_directus_pr445_unbundle_preserve_modules
description: PR #445 unbundle command + --preserve-modules inspection flag — measured verdicts, settled exceptions, don't re-raise
metadata:
  author: Jean Claveau
  type: project
---

MERGED (`0f840eeec7` on hhh-dev, stacked on #444). Two independent deliverables from the
same investigation ("would preserveModules help caching or agent debuggability of
extensions?"):

- **`--preserve-modules`** (extensions-sdk build flag) — the cache hypothesis was
  **refuted by measurement**, not accepted on theory. 944-module extension, 5 alternating
  reps: bundled cold/warm/redeploy = 37/20/32ms; spread-out = 457/392/454ms (~10× slower
  at every point, including the "redeploy, 1 module changed" case that looked strongest
  on paper). Per-module link cost (~0.4ms) swamps every compile the cache saves. Worse:
  a consumer's real domain extension (13.6MB, the module you'd actually want to patch in
  a container) **throws at load** when spread out — `require_lib is not a function` (a
  joi CJS require-cycle whose init order needs everything in one scope) with sqlite3's
  native binding lookup failing right behind it. Vendor is 89% of those bytes, so this is
  the common case, not an edge. Shipped as **inspection-only**: opt-in, prints its own
  cost on every use, refused when `sandbox.enabled` (isolated-vm reads the entrypoint as
  a string and only imports `directus:api` — a spread tree it can never load), app side
  untouched (`manager.ts` re-bundles app.js server-side regardless). Known accepted gap:
  the sandbox refusal only covers the manifest-driven build path — a manifest-less
  `-t hook -i ... --preserve-modules` invocation has no sandbox flag to check and builds
  a tree anyway; not fixed, not worth blocking on.
- **`directus-extension unbundle <bundle|map> <dir>`** — recovers a deployed extension's
  original source tree from its sourcemap's `sources[]`/`sourcesContent[]`. Motivated by
  `-dist` dropping sources: a consumer's domain extension `api.js.map` carries 2086/2107 sources
  with content, recoverable in 3.5s with zero runtime cost, works on what's already
  deployed. Settled design points from two review rounds, all fixed + regression-tested:
  path-traversal segments (`..`, absolute, Windows drive letters) are dropped not
  followed (a stripped filter mutation test wrote `etc/passwd` into the worktree root);
  a source whose path sanitizes to nothing is **not silently dropped** — lands under
  `_unmapped/source-N`, warning names what happened (previously it was dropped AND
  mis-reported as "carries no content"); path collisions **don't overwrite** — the later
  one gets suffixed (`a-2.ts`), both survive (previously the second silently clobbered
  the first with no warning that content was gone); a non-empty target directory is
  refused (a prior extraction's leftovers read exactly like the new build's tree);
  `sourceMappingURL` is followed, not just the `<file>.map` convention; a map >200MB
  warns about the heap instead of dying opaque; `--watch` mode now prints the inspection
  warning too (previously the one place a dev lives all day said nothing).

**Why:** the reads-back-source use case (agent/human debugging a deployed extension) is
served cheaper by `unbundle` than by any bundling-strategy change — no runtime cost,
works on what's already shipped.

**How to apply:** don't re-litigate `--preserve-modules`'s cache case — it's measured
refuted, twice, on both a synthetic and a consumer's real extension. See
[[reference_directus_extension_unbundle]] for when to reach for the command itself.
