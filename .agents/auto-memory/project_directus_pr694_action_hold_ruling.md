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
