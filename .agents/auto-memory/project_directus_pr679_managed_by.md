---
name: project_directus_pr679_managed_by
description: PR #679 directus_access.managed_by — what the guard refuses and the rulings (grant fields only, role delete takes rows along), blackbox select-count traps, app list-m2m fix; #680 bundle rulings (subscription_events, archive sentence, deleted user cancels, 404 closes)
metadata:
  author: Jean Claveau
  type: project
---

`directus_access.managed_by` (varchar 255, null) marks a row owned by an extension (`'@scalabus/subscriptions'`). Core fork PR #679, base of the subscriptions bundle #680 (see [[project_directus_issue652_subscriptions_stripe_survey]]).

**Merged 2026-11-06 as `0b74cde186` (head `ff673181ed`).** Branch kept: #680 still bases on it, and its retarget to `v11.10.1-hhh-dev` is a separate go.

Guard (`api/src/services/access.ts`, `AccessService`): a request (accountability set) may not create with `managed_by`, nor PATCH/DELETE a managed row → `InvalidPayloadError` 400; accountability null (extension code) passes. App: `list-m2m` option `managedByField` shows a "Managed by …" chip instead of remove.

**Why / traps found:**
- The guard adds one `select … from directus_access … managed_by is not null` per guarded write → the blackbox feature tables that pin statement counts (`write-user-integrity.feature`, `singular-write-access.feature`) go red on postgres until each count is bumped by one (query-audit, see [[project_directus_pr600_query_audit]]).
- Delete path did not validate keys before the guard read → `validateKeys` first, else the uuid cast fails in the DB.
- `fieldsStore.getField(junction, managed_by)` must gate fetching `managed_by` in list-m2m, or a policy that cannot read the field gets 403 + empty list.
- Check runs outside the write's transaction: documented race, no test.
- Unit tests for refusal use `toThrow(new InvalidPayloadError({reason}))` ([[reference_directus_vitest4_tothrow_error_class]]).

**Rulings (2026-11-05, head a056201259):**
- Guard refuses only who gets which policy (`role`/`user`/`policy` changed, or a delete); `sort` and the rest pass, so app reorder and batch edit work on a managed row.
- A role delete takes its managed rows along (`deleteRoleAccess`), like the DB cascade on a user or policy; the bundle reacts at its next sync.
- Flow operations using bare ItemsService bypass the guard: predates #679, own PR, not fixed there.

**#680 (bundle) ruled and coded, 2026-11-05:** `subscription_events` + `user_updated` chosen over `user_updated` alone, because a sync used to overwrite `date_updated` each run; a no-change sync now writes nothing. Deleting a user cancels its subscriptions (no users.delete hook: next sync, up to the hourly reconcile). Plans never deleted, archive through an endpoint typing a sentence naming N, ends at period end, no refund; `subscriptions-locked` refused by checkout (next PR), a webhook on it still grants. A provider's 404 closes the row, which also fires on a wrong-mode key. No per-table revision reaper: `retention.ts` filters on `action` only, so disputes rest on `subscription_events`.

**Autoreview round (2026-11-05, head 02b04e88c5, 4 defects fixed, tests seen red on a throwaway CI branch):**
- Guard ran before the permission check → public DELETE got a 400 naming row+extension instead of 403. Fix: check permission only when about to refuse (no extra query on passing writes).
- `{ role: { id: null, name } }` on a null relation passed the guard (`null !== null` false), then payload `processM2O` created the role and attached it. Guard must treat a nested object with null id as a change.
- Relation compare must be case-insensitive on uuids (nested save with uppercase parent key got refused).
- Batch case: `includesAccessKey` condition survived mutation until a test sent unmanaged+managed groups in one `updateBatch`.
- Unreadable `managed_by` in list-m2m: remove button still shown, save 400 → documented only.
- OPEN choices, no ruling yet: (3) `RevisionsService.revert` + flow ops item-create/update/delete use bare ItemsService (reco C now, getService in own PR; the revert variant is unreachable with the bundle since it replaces rows by delete+create); (4) `managed_by` refused even when unchanged, e.g. GET→PATCH or re-import of an export (reco A: refuse only on difference); (8) blackbox scenario for the guard in #680 (reco B). #680 not merged with these fixes; retarget after #679 merges picks them up.

**Re-review round 2 (2026-11-06, head 0e2fc815ee, CI green, not merged):**
- Fixed: list-m2m chip replaced the undo button on a row staged for deletion (chip must skip `$type: 'deleted'`); test added that `deleteRoleAccess` forwards `...opts` (bypassLimits, emitEvents). Both seen red on a throwaway CI branch.
- OPEN choice, no ruling: guard sees the raw payload, but `processPayload` merges permission presets later (`items.ts` ~2223), so an update permission with `presets: {policy}` or a create preset `{managed_by}` evades it. A = move guards into `validateGroupsToUpdate` / `validateRowsToCreate` (base seams `files.ts` uses; run after `validateAccess`; also removes the 400-vs-403 row-existence leak and the `[null]` 500 regression); B = document in PR risks. Reco A. Held for it: `access.ts:204` validates only unmanagedKeys (leak), `access.ts:60` `'managed_by' in null` gives 500, 7 untested guard mutations (batch later group, mixed key group, `data.some`, id-less `{role:{name}}`). Delete has no such seam.
- Dropped after check: create-with-no-access 400 (PR promises 403 only for update/delete), `[U,U]` 403, >65535 keys (1mb MAX_PAYLOAD_SIZE caps ~27k), `managed_by: ''`.
- CodeRabbit never reviews this fork (under 10 stars): autoreview step 4b has nothing to watch; never post `@coderabbitai review` unasked.
- Mutation-review subagent: all 8 survivors came from mocks with one managed row in one group; test batches with several rows/groups.

**Round 2 RULED (2026-11-06): option A+ (consistency over minimal).** All three `directus_access` guards move after the filter hooks, onto the validate methods: `validateRowsToCreate`, `validateGroupsToUpdate`, plus a NEW empty `validateKeysToDelete(_keys, _opts, _trx)` in `items.ts` (after validateAccess, before the delete). Role delete needs an option passed down so `deleteRoleAccess` skips the guard (test pinning role delete 204). `validateRefusedRequest` goes away (native 403 comes first). No helper for extension devs (a filter hook can only give a partial verdict: later hooks, validateAccess, presets); side effects belong in `action` hooks; doc line: "filter hooks run before this refusal, keep side effects in action hooks". Held findings (`[null]` 500, key leak, 7 test gaps) get fixed/tested against the new methods. The role delete's option is `deletesManagedAccess`: `keysFromQuery` cannot tell it from a deleteByQuery. Other core services' order: filed as #690. items.ts order for every collection is already filter hook, validateAccess, presets, validate method, write (fork moved delete hook before validateAccess so a hook can cancel / snapshot scope; `origin/main` has it too, v11.10.1 did not).
**Wording:** jean questioned "seam": say the method name or "validate method", never "seam".

**A+ autoreview (2026-11-06, head ff673181ed):** 11 tests added, 11 seen red. Fixed: linear key match in `validateGroupsToUpdate` (quadratic took 47 s at 27000 keys, 1.7 s at 5000; pinned by a `toLowerCase` call count), `managedByField!` in list-m2m (TS2538, no CI gate runs vue-tsc). Filed on #651: `VersionsService.promote` writes through a bare `ItemsService`; a stored `directus_collections` row beats `systemCollectionRows`, so an admin can turn versioning on for `directus_access`. Read from the code, never run.
- Mutating several guards in one throwaway branch masked a test: a non-admin early return hid the role delete mutation. Run an overlapping mutation alone.
- A knex-mock `select` handler answers whatever the bindings: a test passing keys `[]` still got the managed row, so it also pins `history.select[0].bindings`.
- A vitest typecheck error fails the unit job with every test passed: read `Errors  N errors`, not only `Tests`.

**#680 autoreview of the 8 late commits (2026-11-06, head 043e4c431a):** fixed lock order (queue row before subscription, same as the worker), stored subscription read `FOR UPDATE` on PG, parking follows the due-time CASE, no-plan subscription still revokes (`planReference: null`), malformed plan id 400, malformed secret exits boot. Filed: #651 point 5, #610 points 13-14. The CASE on `pending` has never run on postgres' failure path. Choices awaiting jean: S1, P1, P2, P5, S5+S6, V4.
- A throwaway test inside the suite's describe (`it('red guard …', () => step([{}, {}]))`) sees several helper guards red in one run, where a single sequential scenario stops at the first.

**Why:** a review that only reads the guard unit tests misses the paths that reach the base class (revert, flows, nested payload creates).
**How to apply:** when reviewing any service-level guard, list every `new ItemsService(` caller and every nested-payload create path before trusting it.
