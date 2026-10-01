---
name: project-directus-issue502-impersonation
description: Issue #502 impersonation design (filed as bug 2026-09-17, deep-reviewed same day) — shares the audit's on-behalf-of mint; settled points so a fresh session doesn't re-derive
metadata:
  type: project
---

Issue #502 (label `bug`): admin acts as another user, `json` (stateless short token, = what the cache audit mints privately at `cache-audit.ts:729-748`) and `session` (cookie swap + banner + Stop) modes. Filed and design-reviewed 2026-09-17, not started; ordered after #499 merge, before #500's replay bit so #500 items 2/3 sit on `AuthenticationService.impersonate()`. Issue body IS the design (rewritten in place after review); this file holds only what a fresh session must not re-derive.

Settled:
- Radical `impersonat*`: `Accountability.impersonator`, `DirectusTokenPayload.impersonator`, `directus_sessions.impersonator` + `impersonator_session` (admin's own session TOKEN — Stop re-signs the cookie from it, an id can't), `directus_activity.impersonator` (no FK, parity with `user`), `Action.IMPERSONATE` / `IMPERSONATE_END`, one path `/auth/impersonate` with POST/DELETE/GET, `IMPERSONATION_{ENABLED,TTL,WRITES}`.
- `login()` is NOT reusable as a block (auth.login hooks, limiter, `provider.login()` → IdP, LOGIN row, last_access, stall, always a row + refresh token): extract private `mint()`; `impersonate()` is silent (no activity/log — 47.8k replays/run), accepts `impersonator: null` (scheduled audit runs), refuses inactive targets and, session mode, targets without `app_access`.
- `json` = access token only, no row (else `refresh()` stretches it to 7d); `IMPERSONATION_TTL` caps json ONLY. Session mode = ordinary sliding session, no own cliff: app's failed-refresh path never calls `/auth/logout` and an expired cookie dies in `authenticate` → an expiring impersonation strands the admin on /login. Kick replaces the TTL. Refresh copies both columns on rotation (stateful insert + stateless update + ws refresh_token path) and bumps the admin's own row.
- Writes gate at the transports (HTTP method middleware + GraphQL Mutation root + ws items handler), NOT `validateAccess` (early-returns on admin, 9 services never call it). `/users/me/track/page` no-op 204 under impersonation. Credentials are field-level in `UsersService.updateMany`.
- Attribution: `actorFields(accountability)` helper replaces 6 copy-pasted actor blocks (ActivityService built without accountability everywhere). Target may see `impersonator` in own activity — by design, field permission if a role must not.
- WS: `endSessions(tokens[])` helper owns delete + `session.ended` (sha256 of token, never raw) for logout / clearUserSessions / refresh-non-active / Stop; expiry sweeps excluded (timer). `SESSION_ENDED` ws error. Socket timer follows JWT `exp` not the row. `json` tokens unkickable by design. Local bus without Redis = own worker only.
- `IMPERSONATION_ENABLED=false` gates ENDPOINTS only — audit calls the service regardless.
- New #500 verdict: `unreplayable:user_inactive`.
- `websocket.authenticate` / `authenticate` filter short-circuit loses the claim — extension-owned, documented, not stamped pre-verify.
- Out: share impersonation; the bb `cache-audit-identity` rig stays; absolute session cap (`IMPERSONATION_SESSION_TTL`) parked.
- Follow-ups ruled on (issue section): account switch = linked sessions via `directus_sessions.group` + `/auth/switch` (ask why accounts multiply first — several policies per user already fit); teacher/parent access = OWN identity + relational permission filter, reopens the parked multi-owner cache scoping, NOT impersonation; scoped impersonation = `directus_policies.impersonate_access` + `impersonate_filter`, read-only, target never above impersonator — the only real #502 phase 2.
- PR order inside: actorFields + endSessions (neutral) → mint → service/endpoints/guards → ws kick → app.

**Why:** the audit, #500's `noSideEffects` and impersonation are one "on behalf of" family on `Accountability`; building them apart duplicates the mint.
**How to apply:** when touching #500 items 2/3 or the replay token, mint through `impersonate()`; see [[project-directus-issue498-cache-audit]].
