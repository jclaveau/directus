---
name: project_directus_pr694_action_hold_ruling
description: PR #694 (default mutationBatching -> preserveMutationOrder) autoreview — jean's ruling that action hooks NEVER fire for a rolled-back mutation, the audited early-emit sites, and the singular-write-flows flake
metadata:
  author: Jean Claveau
  type: project
---

**Ruled 2026-11-07 (finding 4, predates the flip):** action events must never fire when the
mutation was cancelled/rolled back. MERGED 2026-11-07 as d2a0022175, fix in d002605a86: services
holding events go through `api/src/utils/transaction-holding-actions.ts`, which empties the
list at each attempt and on failure. Left out: `apply-diff.ts` retry, filed as #610 point 16.

Seen, predates, not fixed: an import hangs if its queue drains before the stream's `end`
registers `drain` (CSV with an instant mock timed out at 5000ms).

Defect probe: `upsertMany([{id:1,name:'uno'},{id:1,name:'boom'}])` with an update filter
throwing `boom refused` → update action fired with `[{data:{name:'uno'},keys:[1]}]`, row
unchanged. Cause: `bypassEmitAction` in `upsertMany` is only set for `disableBatching`.

**Audited sites (what the fix must cover):**
- `items.ts` `upsertMany`: make the bypass unconditional; `upsertRun`'s own
  `segmentActionEvents` buffer becomes dead → remove, fix docblock.
- `createRowByRow`: `rowActionEvents` declared OUTSIDE the transaction handler (TODO #610) →
  a retried attempt fires the aborted attempt's events; declare in handler, return it
  (like `updateGroupByGroup`).
- `roles.ts` `deleteMany`: five sub-calls emit inside the transaction → hold like
  `UsersService.deleteMany`, emit after commit.
- `collections/fields/relations`: emit held events inside `finally` → fire even when the
  transaction failed (13 sites). `extensions.updateOne` emits inside trx too.
- Bound for PR risks: a caller-supplied knex trx gets actions after the service savepoint;
  only `bypassEmitAction` can hold them past a later caller rollback.

**Revision parents moved by the flip** (`{keys:[1,3],parent:4}` → `{keys:[1,2],parent:4}`)
are consistent, not regenerated noise. Raw-SQL-order refusal (`upsertMany([{id:3,name:'one'},
{id:1,name:'uno'}])` → RecordNotUniqueError) is the intended break.

**Flake, cause unknown:** blackbox `singular-write-flows` request 1 `directus_operations`
select 3 vs 2 — failed 2 of 5 attempts on #694, both passed `gh run rerun --failed`. Candidate
(unverified): background flow reload after the preceding `POST /operations`
(`flows.ts:181-185`). Not in #694's diff; flip timing effect not excluded.

Autoreview comment: pull/694#issuecomment-6705961785 (100%, 81/81 at dd58a1bc75). CodeRabbit
does not review this repo. Related: [[project_directus_pr686_autoreview_points]],
[[feedback_directus_default_matches_dbms]].

**Follow-up review of d002605a86 (2026-11-07, branch `v11.10.1-fix/action-hold-review`, new PR
into hhh-dev, never merge):** #694 merged at 7.1% autoreviewed (see
[[feedback_autoreview_percent_before_merge]]), so `dd58a1bc75..d002605a86` was reviewed after.
Verified: activity/revision writes (`items.ts` createMany/recordUpdatedRows/deleteMany) fired
inside the trx → now held; `fields.ts` `createField` was the one site left on plain
`transaction` → `transactionHoldingActions`. Choices left to jean: `roles.ts` `clearCaches()`
before emit loses held actions when Redis fails (same `finally` class in collections/fields/
relations, predates); emit awaited before scoped purge; caller-trx failed-upsert `.catch`
drops actions; roles cascade actions now `Promise.all` (PR-risk line).
Dropped as not-a-bug: versions.ts/flows.ts (no trx), fields.ts:559 alterTable.
sqlite/cockroach points → #610 from point 17 (updateBatch `['a','a','b']`, import retry over a
consumed stream).

**Result (2026-11-07):** fixes in PR #695 (`Refs #694`, not merged); full table and the open choices
(items 7-11) in the autoreview comment on #694. Item 6 is withheld: see `~/.agents/parked/`, never
detail it in this public repo. #610 points 17 and 18 filed.

**Flake again on #695 (2026-11-07):** same family, other scenario: `singular-write-flows` "A single
flow is loaded as it is created", request 3 `directus_operations` select 4 vs 3, shard 5, run
42372465544; passed on `gh run rerun --failed`. Still no cause.

**Autoreview of #695 (2026-11-07, head 68975afab6, not merged):** open choices 2 (activity/revision
actions silent under `emitEvents: false`, real on `POST /files`, replacement upload, TUS; rec fire
them) and 3 (revision snapshot `readMany` fires `<collection>.items.read`, also on rollback; rec
pass `emitEvents: false`). "Only its `bypassEmitAction` can hold them" was checked and is correct.
Item 1 is withheld: see `~/.agents/parked/`. #610 point 19 filed.
