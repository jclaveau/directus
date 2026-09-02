---
name: project_directus_pr393_accepted_exceptions
description: PR #393 "pin a read's nested collections by their parent keys" (fixes #361) — the vocabulary jean imposed, the settled naming/type calls, and the review defects already fixed; do NOT re-raise
metadata:
  type: project
---

PR **#393**, branch `v11.10.1-feat/scoped-cache-pin-embedded-records` (branch name
kept deliberately — renaming a head ref closes the PR), base `v11.10.1-hhh-dev`,
Fixes #361. Green incl. blackbox as of `c926db44fa`.

**Vocabulary — settled, and it is `run-ast`'s, not mine.** "Embedded" was my coinage
and appears nowhere in `api/src` before this branch. The code says **nested** for a
collection pulled into a response (`NestedCollectionNode`, `nestedItems`) and
**parent** for the far side of an M2O (`mergeWithParentItems`, `parentsByForeignKey`).
Everything was swept to that; see [[feedback_use_the_codebases_own_word]].

**Settled names, do NOT re-propose:**
`pinnedScopedCacheTagsFromM2oParents`, `resolveScopedCacheM2oJoinChainFromPath`
(the `…From<X>` suffix names the PRIMARY INPUT, not the schema it looks up in),
`m2oParentRowsAtPathEnd` (AtPathEnd, not AlongPath — only terminal rows return),
`ScopedCacheM2oJoin`, `SCOPED_CACHE_M2O_PARENT_PIN_CEILING`, `FieldTypesByField`,
`recordsWithTemporaryFields`, `pinnableFromNestedRows`,
`tests/blackbox/…/cache-m2o-parent-key-pin.test.ts`.

**Settled type calls:** annotate from the producer (`ReturnType<typeof fieldMapFromAst>`),
reuse `Item` / `QueryPath` / `CollectionKey` / `FieldMap`, and spell a path key
`QueryPath[number]` — jean rejected a `QueryPathKey` alias after I argued it reads as a
segment rather than a joined path. His call, applied.

**Still open by design:** the ceiling value (`TODO(reviewer)`, tracked in #392); A2O
left bare; the unbounded-spread class filed as **#397**.

**Review round already fixed — do not re-find:** two staleness paths and a RangeError
([[project_directus_scoped_cache_pin_soundness]]), the `ForbiddenError` guard reading
the pre-strip value, and six untested-but-load-bearing branches.

Related: [[project_directus_pr358_accepted_exceptions]], [[project_directus_cache_key_identities]].

## MERGED 2026-08-27, second review round settled — do NOT re-raise

Five more findings, all fixed on the branch before the merge:

- **A nested node's filter reaches PAST the parent it withholds.**
  `scopedCacheCollectionsBeyondNestedRows` read only the ROOT query;
  `deep[owner][_filter][company][name]` left `company` pinned to the one company the
  response nested. Now `extractFieldsFromQuery` runs against EVERY m2o node's query and
  cases; the `whenCase` arm stays beside it because a field-level case is not a filter.
- **The strip is one call site again.** `items.ts` owning `removeTemporaryFields` left
  it mirroring run-ast's strip condition. `RunASTOptions.onRowsWithTemporaryFields` is
  the seam now. NOT an upstream-drift concern — this fork pins one BSL tag, so a change
  there arrives as a reviewed version bump; the exposure was to our own future edits.
- **`run-ast.ts:99` returns early on an empty result**, before the seam. Anything
  derived from the AST alone (the field map) must be computed OUTSIDE the callback or a
  zero-row read carries no tag at all. Pinned by `tags every collection it read, even
  when no row came back`.
- **`batch-insert.test.ts` writes `batch-N` rows into the collection
  `no-relation.test.ts` subscribes to** over a WebSocket; neither was serialised. The
  writer is now in the `after` chain. Not caused by this PR — the packer A/B is
  identical with and without its own two `after` entries.
- **The ceiling is `CACHE_SCOPED_MAX_PINS_PER_COLLECTION`** (default 250), and it is
  NOT the bound #392 decides — see [[feedback_knob_only_when_no_setting_breaks_correctness]].

**Settled, closed:** `SCOPED_CACHE_TAG_TTL_FACTOR` and `PIN_UNSAFE_SCOPE_TYPES` stay
constants on purpose. `scopedCacheTagsFromRows` still takes `Record<string, any>[]`
rather than `Item[]` — predates the PR, offered and not taken up.
