---
name: project_directus_pr679_managed_by
description: PR #679 directus_access.managed_by — what the guard refuses and the rulings (grant fields only, role delete takes rows along), blackbox select-count traps, app list-m2m fix; #680 bundle rulings (subscription_events, archive sentence, deleted user cancels, 404 closes)
metadata:
  author: Jean Claveau
  type: project
---

`directus_access.managed_by` (varchar 255, null) marks a row owned by an extension (`'@scalabus/subscriptions'`). Core fork PR #679, base of the subscriptions bundle #680 (see [[project_directus_issue652_subscriptions_stripe_survey]]).

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
