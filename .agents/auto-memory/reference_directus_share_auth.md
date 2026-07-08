---
name: reference_directus_share_auth
description: how Directus public shares authenticate & resolve permissions — token hardcodes role:null, permissions resolve at consume from directus_shares.role, routing accountability ≠ permission accountability
metadata:
  type: reference
---

Directus **public shares** (`directus_shares`, `accountability.share`):

- **The share JWT carries `role: null`** — hardcoded in `SharesService.login()` (`shares.ts` `tokenPayload`). So the token grants no role; a share is anonymous (no user, no policies) as far as the request accountability goes → `fetchGlobalAccess` returns nothing → `grantedDbConnections: []` → routes to the default DB pool. This is why finding #6 (shares → base pool) holds.
- **Permissions DO resolve from the share's role — at consume time, server-side.** `get-permissions-for-share.ts` calls `fetchShareInfo(accountability.share)` → `{ collection, item, role, user_created }` (from the share row) → builds a SECOND, internal share-accountability from that `role` → runs `fetchGlobalAccess(shareAccountability)`. So the share's role's policies ARE applied — but only for computing the shared item's permissions, NOT propagated to the routing accountability the `ItemsService` ctor uses.
- **Two accountabilities per share request:** (1) the request one from the token (role null, `share` set, empty grants) → used for **DB routing** (`getDatabaseForAccountability`); (2) the internal one built from `directus_shares.role` → used only for **permission** computation. They don't share `grantedDbConnections`.
- **`share` is a first-class `PermissionsAction`** (`packages/system-data/src/types.ts`). `SharesService.createOne` gates every share behind `validateAccess({ action: 'share', collection, primaryKeys })` against the CREATOR's policies → "who may share" is native RBAC (grant the `share` action per policy).

**Consequence for pool routing:** to route a share by its role's policy, resolve the share role's grant at `login()` and stamp it on the token (grant, not role) — no new column. See [[project_directus_db_connection_priority]] + issue #216.
