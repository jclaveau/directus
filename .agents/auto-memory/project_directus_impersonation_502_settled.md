---
name: project_directus_impersonation_502_settled
description: Issue #502 impersonation — settled design points after the 2026-09-17 review (cookie mode first, bot impersonator not null, logout ends both, kick selectors, credential guard = no-logout invariant); do NOT re-raise
metadata:
  type: project
---

Issue #502 (impersonation) body was rewritten 2026-09-17 to the shape ruled in
review. Settled, do not re-litigate:

- **Modes = `json | cookie | session`** mirroring `/auth/login`. `cookie` comes
  FIRST: planner students have `app_access=false` and the planner SDK runs cookie
  mode, so session mode (Data Studio swap) is secondary. Cookie mode leaves the
  Studio session cookie untouched; Stop = `/auth/logout`.
- **No null impersonator.** Machine actors are `directus_users` rows: radical
  `bot`, role `Bots`, one policy per bot on `directus_access.user`, display
  "Cache audit bot" (first_name=job, last_name=bot), fixed-uuid migration. Bots are
  never targets, never login (password null). Non-identity attrs
  (`grantedDbConnections`) come from the impersonator, identity from the target.
- **Logout under a SESSION-mode impersonation ends BOTH rows** (impersonated +
  admin's own); `DELETE /auth/impersonate` (Stop) is the only restore path. A
  cookie-mode row links no `impersonator_session`: its logout ends itself only,
  and the admin's Studio logout leaves it alone (symmetric, bb-pinned).
- **`impersonator_session` FK → `directus_sessions.token` ON DELETE CASCADE**
  (token is PK) is only the net: `endSessions({tokens})` selects
  `impersonator_session IN tokens` too, so a session-mode impersonation ended
  through its admin's row leaves its `impersonate_end` trail and kicks its
  socket (review 2026-09-17 #1); a user-keyed kick (`clearUserSessions`) reaches
  impersonations via `impersonator IN users`.
- **Identity is the target's, the pool the impersonator's**:
  `getAccountabilityForToken` overrides `grantedDbConnections` from the
  impersonator's own roles/policies and 401s when the impersonator is no longer
  active (json tokens die with a suspended admin, not only rows).
- **`refresh()` skips `provider.refresh()`** on impersonated rows (oauth2/openid
  rotate the TARGET's IdP token) and leaves `last_access` alone.
- **Write guard**: allow GET/HEAD/OPTIONS/SEARCH + `/graphql*` (reads are POST);
  GraphQL guard lives in `middleware/graphql.ts` on `operationAST.operation`.
- **Credential-field guard is the no-logout invariant**: the refused fields are
  the only path to `clearUserSessions(target)`, so an impersonation can never end
  the target's real sessions. Test it as such.
- **ws kick stays in the PR** with selectors `{tokens}` (logout/Stop),
  `{impersonator}` (admin kicked), `{user}` (target inactive); never "user of an
  impersonated session". Rotation is not a gap (token and JWT age together).
- **App**: id-compare reload in `refresh()`, presets `temporary`, skip
  `enforce_tfa` redirect under impersonation.

**Why:** each was argued from code refs in the review comment on #502; re-raising
costs a round trip jean already paid.
**How to apply:** build in the issue's Order; when a reviewer questions one of
these, point at the issue body + first comment instead of reopening.
