# Unique indexes in the schema (#620 → #337)

Handoff written 2026-11-10 from session b12d73b9 (#414 work). Goal: move a
consumer's hook-side dedup into the fork, starting with making Directus see
every unique index.

## jean's rulings so far (2026-11-10)

1. Step 1 is read-only: introspect + API + admin display. Keep the door open to a
   managed follow-up (create/drop from the admin, snapshot apply).
2. Derive per-column `is_unique` from the new list: fine.
3. Asked: is `is_unique` upstream or ours? → upstream
   (`packages/schema/src/dialects/postgres.ts:493`, unchanged vs `origin/main`).
   The fork only added `in_unique_index` (b11ece8dc5).
4. Unique indexes should appear in the schema snapshot, as they would be stored
   in managed mode. Open point below: what `schema apply` does with them.
5. Admin display: go.
6. Postgres only (other dialects → #610).
7. jean thinks "upsert on unique" should be the DEFAULT behaviour. Discuss once
   unique indexes are supported (see "Later" below).
8. Hook-side dedup stays supported: a unicity with custom logic must still be
   possible in a create filter hook, even once unique indexes cover most cases.

## Existing issues (all open, jclaveau/directus)

- #620 SchemaOverview has no unique constraints or indexes → this IS step 1.
  Proposes `schema.collections.<c>.unicities = [{ name, fields, where }]`.
- #329 schema layer blind to partial unique indexes.
- #337 umbrella: uniqueness as one configurable feature (plain / partial /
  related-field predicate / expression / cross-collection × reject / merge /
  custom error).
- #450 scoped cache needs uniqueness in SchemaOverview (o2o back-reference pin).
- #606 merge nested update groups whose items share an identity (needs this).

## Past discussions (session transcripts under ~/.claude/projects)

- 1ac7467d (Oct): "the deduplication should occur during
  upserts, not create. During creates, duplicates should trigger an exception";
  "match against the whole unicity: pk and unique indexes"; identical rows may
  need to be accepted in specific cases → `sameRowAs`; "be conservative, error
  on conflict"; "duplicate create forbidden based on its unicity, not its nested
  relations"; "updating the same row in a batch should be forbidden"; asked
  whether a pg unique index can target a related field (→ no, denormalize).
- 9ee7c9f2 (deps-directus-cms-2, ~10-22): "should the create takeover be moved to
  the upsert? Is there an items.upsert event?"; nested groups can only merge once
  the by-unique-identity dedup lives on the fork side (→ #606).
- a56849fa (knex-update): "unique violation should simply trigger an error
  instead of trying another way".

## Facts established

What Directus sees today (postgres.ts:446-493): `is_unique` comes from
`pg_constraint` filtered `array_length(conkey) <= 1`.

| DB | `is_unique` today |
|---|---|
| `email UNIQUE` (constraint) | `email: true` |
| `CREATE UNIQUE INDEX ON t (email)` | `email: false` |
| `UNIQUE (discipline, type, key)` | all three `false` |

A consumer's schema (measured): 17 `ADD CONSTRAINT … UNIQUE (…)`, none partial,
expression, INCLUDE or NULLS NOT DISTINCT; its multi-column ones are invisible to
Directus.

What a consumer's hook-side dedup had to decide (the native version must answer
the same questions):
- unicities read from `pg_indexes` by regex break on partial (predicate captured
  as a field), INCLUDE, expression, NULLS NOT DISTINCT, quoted names.
- a stored row matches only if it matches EVERY unicity the input holds (with
  "any", a create holding an existing id moved the row).
- null in a unique field → that unicity unmatchable; stored null never matches,
  not even "null".
- String() comparison; a relation object without id is matched on its fields
  (the filter runs BEFORE processM2O).
- rows of one batch sharing a unicity: identical → `sameRowAs`, differing → 400
  RECORD_NOT_UNIQUE; two inputs resolving to one stored row → refuse.
- unchanged takeover → `{key}` + `scopedCache.skipPurgeFor`; changed → update,
  then `purgeBy`.
- a related-field predicate cannot be a pg unique index: it stays hook-side.

In practice the unique columns are often the whole payload, so a takeover is a
no-op `{key}`; same-request duplicates are real (two created rows sharing one
nested record), so with #686/#717 batching the native version must collapse
identical rows.

## Step 1 shape (proposal, Postgres, read-only)

One query on `pg_index` + `pg_class` (+ `pg_constraint` for constraint/
deferrable): `indkey`, `indnkeyatts` (key vs INCLUDE), `pg_get_expr(indpred)`,
`pg_get_indexdef(oid, k, true)` per expression column, `indnullsnotdistinct`.

```ts
schema.collections.segment.uniqueIndexes = [
  { name: 'segment_pkey', primary: true,
    columns: [{ field: 'id' }], predicate: null,
    nullsDistinct: true, include: [], constraint: true, deferrable: false },
  { name: 'segment_discipline_type_key_unique', primary: false,
    columns: [{ field: 'discipline' }, { field: 'type' }, { field: 'key' }],
    predicate: null, nullsDistinct: true, include: [],
    constraint: true, deferrable: false },
]
// partial:    predicate: 'deleted_at IS NULL'
// expression: columns: [{ expression: 'lower(email)' }]
// PG15+:      nullsDistinct: false
```

- API: `GET /collections/:c` → `schema.unique_indexes`.
- Admin: read-only "Unique indexes" section on the Data Model collection page.
- `is_unique` derived: column alone forms a non-partial unique index.
- Reloads with the schema cache like columns do.

## Open points for jean

- Name: `unicities` (#620, a consumer's word, covers constraints + indexes) vs
  `uniqueIndexes`.
- Snapshot (ruling 4): include them; `schema diff` reports them. What does
  `schema apply` do with a unique-index diff while read-only?
  A: refuse 400 naming the index · B: apply the rest, return the skipped ones.
- Later (after step 1): default behaviour. Note `.agents/auto-memory/
  feedback_directus_default_matches_dbms.md` — default = raw SQL. For create,
  raw SQL is INSERT → unique violation (refuse). For upsert, raw SQL is
  `INSERT … ON CONFLICT (<target>) DO UPDATE`, so matching a unique index is
  SQL-expressible; the question is which target when several indexes match.
- Hook-side custom dedup (ruling 8): keep the create-filter takeover contract
  (`{key}`, `sameRowAs`, `skipPurgeFor`, `purgeBy({forKey})`) as the extension
  point; the native option builds on the same contract.

## Rulings 2026-11-10 (second session) — supersede the open points above

- Name: schema layer = `uniqueIndexes` (API `unique_indexes`), a DB fact.
  "Unicity" = item layer only: a future `ItemUnicityService` (mirrors
  `ItemScopedCacheService`, held by ItemsService) merging `uniqueIndexes` +
  programmatic rules registered by extensions (`key: row => string`).
  Reason: a schema stores data, never functions.
- `schema apply` with a unique-index diff while read-only: **B** — apply the
  rest, return the skipped unique-index diffs.
- Declarative rules (partial / related-field predicates) stay in code, not in
  schema meta.
- Create-filter takeover stays supported for flexibility.
- Same-batch duplicates (#717/#721 question) apply to EVERY unicity source,
  not only programmatic; S4 `sameRowAs` = collapse identical rows, reused by
  the native version. Programmatic rules add only the no-DB-guard race.
- Order: **paused until #717 / #721 finish in their own session.** Then step 1
  (independent of items.ts, could have run in parallel); `ItemUnicityService`
  only after #717 merges (same create path).

## Related state

- #717 (option S batching) blocked consumer bumps until their dedup handled
  identical rows; #721 stacked on it. Both merged 2026-11-11.
