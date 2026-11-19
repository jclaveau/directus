---
name: project_directus_issue746_multi_role
description: Issue #746 multi-role design (design phase, 2026-11-19) — settled $CURRENT_ROLE drop + $CURRENT_MEMBER_ROLES, the facts a fresh session must not re-derive, open decisions D1-D8
metadata:
  type: project
---

Issue #746 "A user can hold only one role": `directus_role_members {user, role, sort, managed_by}` m2m replacing `directus_users.role`. Branch `multi-role`. PR 1 = #747, PR 2 = draft #749. **The issue body IS the design** (rewritten 2026-11-19, open points D1-D10 there); this file holds only what a fresh session must not re-derive.

**Plan ruled by jean: 2 PRs.** PR 1 = bb Gherkin scenarios pinning TODAY's single-role behaviour on every impacted logic branch (no source change; table in the issue). PR 2 = everything else in one: API + migration + `$CURRENT_MEMBER_ROLES` + app, SSO multi-group (D6), admin UI roles m2m + policy-source list; each PR 1 scenario it edits is a contract change listed in its body.

**Settled by jean (2026-11-19):**
- Drop `$CURRENT_ROLE` entirely (no "primary role"). Keep `$CURRENT_ROLES` (memberships + ancestors).
- Add `$CURRENT_MEMBER_ROLES` = the m2m rows as stored, by `sort`, no ancestors. Not `$CURRENT_ROOT_ROLES`: "root" = parent-less role in this codebase.
- Migration rewrites stored values `_eq $CURRENT_ROLE` → `_in $CURRENT_MEMBER_ROLES`, `_neq` → `_nin` (exactly today's rows for a single-role user); refuses + names any row it cannot rewrite (`$CURRENT_ROLE.field`, other operators). A new write using `$CURRENT_ROLE` is refused (left alone it stays a literal: PG uuid-cast 500, sqlite silent no-match).

**Facts (don't re-derive):**
- Roles/parents/policies compose by UNION (`role _in roles`, `admin ||=`, permission cases `_or`); only shares intersect. Multi-role needs no new combining rule; order only matters for presets (`assign`, last wins, `process-payload.ts:112`) and `withCache` keys built from the `roles` array.
- A parent role ≠ a second role: one parent per role, applies to every member.
- `parseFilter` matches by `startsWith('$CURRENT_ROLES')` then `'$CURRENT_ROLE'`: a new variable must not start with either prefix.
- JWT carries `role` (required claim, `jwt.ts:28`), 4 minters (login, refresh, share, cache-audit); `getAccountabilityForToken` trusts it → a role change is stale up to ACCESS_TOKEN_TTL / SESSION_COOKIE_TTL.
- User counts / last-admin guard use `whereIn('role')` on `directus_users` (`get-user-count-query.ts`) → need EXISTS / "no admin role at all".
- Role delete suspends all users of the role (`roles.ts:93-116`).
- SSO `ROLE_MAPPING`: first matching group wins (`oauth2.ts:178`, openid same), LDAP `.first()`.

**Ruled by jean (2026-11-19, after slice 1 = draft #749)** — full text in the issue's "Ruled by jean" table:
- D1 `PATCH /users {role}` → refused, full message, no replace-all sugar.
- D10 `accountability.role` → removed.
- D8 option A: invite rows `managed_by "invite:<inviter id>"` (never bare `invite`); same inviter re-invites = replace its rows, other inviter = add; one acceptance enables all; `managed_by` kept after acceptance; SSO sync never touches `invite:*`. Option B (per-invitation acceptance) = #750.
- D9 option C: specials → `roles-created`/`roles-updated`, json array of the member roles whose policies allowed the write (inherited policy → the member role it came through; user-only policy → `[]`; admin → member roles with an `admin_access` policy; conditions checked on update). Migration `x` → `[x]`, drops the m2o, renames, names each field; old names refused on write. Hint: `fetch-policies.ts` reads each access row's `role` then drops it — keep the policy→role link.
- D2, D3, D5, D6, D7: the issue's recommendation stands.
- Coverage gap: app `stores/presets.ts` has no test; pin today's behaviour (red then green) before moving it to member roles (slice 3).
