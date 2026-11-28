---
name: project_directus_emptied_payload_skips_access_check
description: A service override that takes keys out of a payload before ItemsService sees it must run validateAccess itself — an emptied row skips the access check and drops its stored refusal (#772, batch PATCH /users moved another user's email with a 204)
metadata:
  author: Jean Claveau
  type: project
---

`UsersService.updateGroups` takes `email`, `provider`, `external_identifier`,
`auth_data` out of each group and writes them to `directus_user_identities` after
`super.updateGroups`. A group left empty reached the items service with no data: no
access check, and its `preMutationErrorsByKey` refusal was dropped.

```
non-admin  PATCH /users  [{ id: <other>, email: 'x@y.z' }]
before d5dbc439d2 → 204, email moved
after             → 403
```

**Why:** a security hole on the #772 branch; fixed in `d5dbc439d2`.

**How to apply:** any override that diverts payload keys to another table (users,
and any system service doing the same): `validateAccess` on the group's keys before
diverting, drop the keys from a refused group too, throw an emptied group's refusal.
Test the batch shape with a row carrying ONLY the diverted keys, sent by a
non-admin. Related: [[project_directus_pr387_update_groups]].
