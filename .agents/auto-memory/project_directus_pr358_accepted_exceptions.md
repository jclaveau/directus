---
name: project_directus_pr358_accepted_exceptions
description: PR #358 "pin the primary key implicitly on every collection" — settled review points, do NOT re-raise (scope is one goal, batch fan-out accepted, self-ref collection delete 500)
metadata:
  type: project
---

PR **#358** (branch `v11.10.1-feat/scoped-cache-pin-primary-key`, base
`v11.10.1-hhh-dev`, closes #357). Settled during review on 2026-08-17 — a fresh session
must not reopen these.

**Scope: one goal, keep the commits together.** The PR carries the pk axis PLUS the
single-item-read controller fix, the uuid/integer spelling canonicalization and the
`flushCaches` tag-index drop. I proposed splitting the last two as standalone bug fixes;
jean: _"Only one goal: more efficient cache without needing config"_. All four serve
that one goal — do not re-suggest a split.

**Unbounded pk-tag fan-out on a huge batch: accepted, no cap.** `MAX_BATCH_MUTATION`
defaults to `Infinity`, so a big `updateByQuery` emits one tag per row. jean: _"batch
mutation is rarely big (may only be during imports) so it can trigger some dozens of
redis del on update without big impact"_. Do not add a cap-and-degrade-to-collection-wide
knob. The measured shape (worth restating, not re-arguing): `purgeScopedCacheTagKeys`
issues its `SMEMBERS` and its per-member `cache.delete` through `Promise.all` — one tick,
pipelined by ioredis, so wall clock is ~1 round trip regardless of N — then a single
`redis.del(...tagKeys)`. All awaited **inside** the mutation, so the time lands on the
write's own latency. The only hard edge is the argument spread on `del`, which throws
`RangeError` past ~100k keys; import-sized batches are the only way to reach it.

**`DELETE /collections/<self-referential collection>` answers 500** ("Cannot read
properties of undefined (reading 'sql')") and leaves the collection behind — verified on
sqlite, not on postgres. `DeleteCollection` in the bb helpers never reads the response, so
the leak is silent. Any bb suite creating a self-relation must `DeleteField` it before
`DeleteCollection` (`cache-primary-key-scope.test.ts` does). Not filed as an issue yet.

**Not bugs (asked and answered):** `evalLeaf` marks a node covered with an empty `_in`
value set — sound, since an empty `_in` matches no rows. The mutated-primary-key hole is
unreachable through the API: `items.ts` strips the pk from the update payload
(`without(fields, primaryKeyField, …aliases)`); enforcement is filed as **#359**.

**Second review round, settled 2026-08-18 — also closed.**
- `meta=total_count` staleness: FIXED (bare collection tag rides beside the pins in
  `respond.ts`). It is `filterCount(collection, {})`, so the entry depends on rows the
  pins never bounded.
- Undeclared take-over now coarse on EVERY collection, not just scoped ones: the key
  it returned is not the only row it may have written.
- Hook-declared tags get their `type` filled from the schema in the collector — with
  uuid lowercasing, a type-less tag and the schema-typed one resolved different keys.
- `!` on `schema.collections[collection]` in `snapshotScopedCacheTags` → `?.` + early
  return, matching the read side.
- Split into follow-ups, do NOT re-derive: **#362** (21 system controllers drop the
  read's pins, so the axis reaches `/items` only — safe, over-purge), **#363** (a
  nested write purges before its parent commits), **#364** (an extension-opened
  transaction escapes the deferral), **#365** (post-commit purge failure policy —
  IMPLEMENTED on this branch).
- Rejected on purpose: `maxRetriesPerRequest: null`, `commandTimeout`, a
  namespace-suspect flag (incoherent — writing the flag has the same failure mode as
  writing the record it substitutes for), and descriptors as a correctness index
  (`CACHE_STATS_ENABLED` defaults off + Redis-buffered ⇒ incomplete).
- The branch also carries five Redis-resilience commits unrelated to the pk axis —
  see [[project_directus_redis_outage_kills_process]]. I recommended splitting them
  out; decision still open.

Related: [[project_directus_cache_key_identities]], [[reference_directus_scopedcache_api]],
[[feedback_directus_pg_only_dialect_focus]].

**Third round, settled 2026-08-19 — also closed.**
- The Redis-resilience commits were **split into #366**, which #358 is now stacked on.
  Do not re-suggest splitting anything else out of #358.
- Review found 11 items; all fixed except two named below. Fixed: the report step no
  longer gates the purge, a `collection`-mode row with a NULL collection is kept
  rather than deleted as success, the drain counts ROWS not collapsed targets, drains
  are chained so `ready` cannot overlap them, `purgeScopedCache`'s orphaned docblock,
  one `scopedCacheSidecarOwner` (this NARROWED the eviction count — `lastIndexOf('__')`
  used to treat any member containing `__` as a sidecar), the duplicated tag-key
  spelling, the migration's false "DISTINCT" claim, the bb proxy left listening.
- **`Query.meta` is now declared** in `packages/types` and the three casts are gone —
  jean overruled my "it diverges from a pristine upstream file"
  ([[feedback_directus_diverge_from_upstream_freely]]).
- Still open by design: the fifth floating-promise owner, and the `_in` pin fan-out
  ceiling pending the planner's real N.


**Scope, still open (2026-08-19):** #358 carries **two goals** — the pk-pinning feature
in its title, and eight commits of #365 post-commit purge recovery (`purgeOrRecord`,
`directus_scoped_cache_pending_purges`, retry on `ready`). #366 was split out of it for
resilience; #365 was left in. Whether it should be split too is unanswered — raised,
not settled. After #366 merged, #358 was retargeted from the merged branch to
`v11.10.1-hhh-dev` and rebased (`be3a2a1`), which is when
[[project_directus_purge_recovery_bare_tag]] surfaced.

## MERGED 2026-08-24 (`ba5c13499`), review round settled

A second review after the base merge found and fixed two regressions — both pinned by a
test pushed red first, both verified by reverting the fix alone:

- The drain asked the entry store's `isReady`, which is false before the first dial too,
  so boot recovery drained nothing. Now round-trips a write
  ([[project_directus_purge_recovery_bare_tag]]).
- `flushCaches` failed a schema apply during an outage — `clearPermissionCache()` is a
  `@directus/memory` multi cache that raises where Keyv swallows
  ([[project_directus_cache_failure_semantics]]). Now best-effort.

**Settled, do NOT re-raise:**

- `clearCacheTargets` still throws on an unreachable Redis — deliberate, an operator
  asked for that clear. Only `flushCaches` is best-effort.
- `createScopedCacheCollector(schema)` is required, not optional; the 8 test call sites
  pass an explicitly empty `SchemaBuilder().build()` to keep behaviour unchanged.
- `scoped_cache_tag` as `varchar(255)` matches the sibling `20260811A` table — a
  consistent pre-existing limit, not this PR's.
- `purgeScopedCache` returns the resolved tags even when the purge FAILED and was
  recorded (the dev header names what SHOULD have gone). Deliberate, tested.

**Left open on purpose, tracked elsewhere:** the fan-out ceilings
([[project_directus_issue392_purge_fanout]]), `mode:'namespace'` being unrecordable, and
the permission cache serving stale entries after a reconnect (nothing re-clears it).
