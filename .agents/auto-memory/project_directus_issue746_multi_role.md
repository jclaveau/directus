---
name: project_directus_issue746_multi_role
description: Issue #746 multi-role design (design phase, 2026-11-19) — settled $CURRENT_ROLE drop + $CURRENT_MEMBER_ROLES, the facts a fresh session must not re-derive, open decisions D1-D8
metadata:
  type: project
---

Issue #746 "A user can hold only one role": `directus_role_members {user, role, sort, managed_by}` m2m replacing `directus_users.role`. Branch `multi-role`. Design phase, nothing coded. **The issue body IS the design** (rewritten 2026-11-19, open points D1-D10 there); this file holds only what a fresh session must not re-derive.

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

**Open (recommendations given, no ruling):** D1 column fate (with no primary role: drop, maybe `PATCH {role}` as replace-all sugar); D2 sibling preset order = membership `sort`; D3 memberships read from DB per request (cached per user), drop the JWT claim; D5 junction service owns guards + cache clear; D6 SSO multi-group → `managed_by "auth:<provider>"` rows, default on or opt-in; D7 role delete suspends only users left with no role; D8 invite `roles[]`, re-invite replace vs add; `role-created`/`role-updated` specials removed or converted; `accountability.role` removed or null.
