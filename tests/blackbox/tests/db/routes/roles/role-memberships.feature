Feature: A user holds several roles, each one a membership

  - A user's roles are rows of `directus_role_members` (#746), written
    through the `roles` field: `roles: [{ role, sort }]`. A user gets what
    every member role's policies allow, and app access lets them read their
    own memberships. The single `role` field is gone: a write sending it is
    refused.
  - A deleted role takes its memberships along, and suspends only the users
    it leaves with no role.
  - A role changes what its user may do: only an admin, or code, writes a
    membership. A request of anyone else is refused, whatever the permissions
    say; `/users/invite` writes invites, never a membership.
  - An invitation is a row of `directus_invites` per inviter and role, shown
    by the user's `invites` field; a re-invite by the same inviter replaces
    its rows. No membership is written until the user accepts: accepting
    turns the invites into memberships, one per role, after the roles held,
    then deletes them. A deleted inviter leaves their invites, naming no
    user. A write of the status alone leaves the invites pending.
  - `managed_by` names what manages a membership: `auth:<provider>` or an
    extension; a request neither sets it nor changes such a membership. An
    admin deletes one whose provider maps no role: no login replaces it.
  - A user holds a role once per `managed_by`: a second membership of the
    same role from the same manager is refused, whether a write creates it
    or moves another membership onto that role.
  - A membership's `user` never changes: a write handing it to another user
    is refused, and the user sent back as stored changes nothing.
  - A Given states the database rows a scenario starts from, written straight
    into the database; the feature's collection is created before it runs.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a member of two roles reads what either role's policy allows
    Given the rows of membership_notes:
      | label  |
      | first  |
      | second |
      | third  |
    And the rows of directus_policies:
      | id         | name         | app_access | admin_access |
      | <p-first>  | first-<run>  | true       | false        |
      | <p-second> | second-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy     | collection       | action | fields | permissions                |
      | <p-first>  | membership_notes | read   | *      | {"label":{"_eq":"first"}}  |
      | <p-second> | membership_notes | read   | *      | {"label":{"_eq":"second"}} |
    And the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    And the rows of directus_access:
      | id         | role          | policy     |
      | <access-1> | <first-role>  | <p-first>  |
      | <access-2> | <second-role> | <p-second> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <member> | member-<run>@example.com | member-<run> |
    And the rows of directus_role_members:
      | id         | user     | role          | sort |
      | <member-1> | <member> | <first-role>  | 1    |
      | <member-2> | <member> | <second-role> | 2    |
    Then these requests get these responses:
      | request                         | response                    |
      | as: member-<run>                | code: 200                   |+
      | method: GET                     | body:                       |
      | path: /items/membership_notes   |   data:                     |
      | query:                          |     - label: first          |
      |   fields: label                 |     - label: second         |
      |   sort: label                   |                             |
      | as: member-<run>                | code: 200                   |+
      | method: GET                     | body:                       |
      | path: /users/me                 |   data:                     |
      | query:                          |     roles:                  |
      |   fields: roles.role,roles.sort |       - role: <first-role>  |
      |                                 |         sort: 1             |
      |                                 |       - role: <second-role> |
      |                                 |         sort: 2             |

  Scenario: a user write sending the single role field is refused
    Given the rows of directus_roles:
      | id             | name          |
      | <refused-role> | refused-<run> |
    And the rows of directus_users:
      | id          | email                  |
      | <kept-user> | kept-<run>@example.com |
    Then these requests get these responses:
      | request                       | response                               |
      | method: POST                  | code: 400                              |+
      | path: /users                  | body:                                  |
      | payload:                      |   errors:                              |
      |   email: no-<run>@example.com |     - message: >-                      |
      |   role: <refused-role>        |         Invalid payload. "role" is     |
      |                               |         replaced by the memberships in |
      |                               |         "roles": send "roles": [{      |
      |                               |         "role": <role id> }].          |
      | method: PATCH                 | code: 400                              |+
      | path: /users/<kept-user>      | body:                                  |
      | payload:                      |   errors:                              |
      |   role: <refused-role>        |     - message: >-                      |
      |                               |         Invalid payload. "role" is     |
      |                               |         replaced by the memberships in |
      |                               |         "roles": send "roles": [{      |
      |                               |         "role": <role id> }].          |
      | method: GET                   | code: 200                              |+
      | path: /users/<kept-user>      | body:                                  |
      | query:                        |   data:                                |
      |   fields: roles               |     roles: []                          |

  Scenario: a deleted role suspends only the users it leaves with no role
    Given the rows of directus_roles:
      | id             | name          |
      | <deleted-role> | deleted-<run> |
      | <kept-role>    | kept-<run>    |
    And the rows of directus_users:
      | id              | email                    |
      | <only-member>   | only-<run>@example.com   |
      | <double-member> | double-<run>@example.com |
    And the rows of directus_role_members:
      | id         | user            | role           | sort |
      | <member-1> | <only-member>   | <deleted-role> | 1    |
      | <member-2> | <double-member> | <deleted-role> | 1    |
      | <member-3> | <double-member> | <kept-role>    | 2    |
    Then these requests get these responses:
      | request                      | response                  |
      | method: DELETE               | code: 204                 |+
      | path: /roles/<deleted-role>  |                           |
      | method: GET                  | code: 200                 |+
      | path: /users/<only-member>   | body:                     |
      | query:                       |   data:                   |
      |   fields: status,roles.role  |     status: suspended     |
      |                              |     roles: []             |
      | method: GET                  | code: 200                 |+
      | path: /users/<double-member> | body:                     |
      | query:                       |   data:                   |
      |   fields: status,roles.role  |     status: active        |
      |                              |     roles:                |
      |                              |       - role: <kept-role> |

  Scenario: a role invited by two inviters becomes one membership once accepted
    Given the rows of directus_policies:
      | id               | name          | app_access | admin_access |
      | <inviter-policy> | inviter-<run> | true       | true         |
    And the rows of directus_roles:
      | id             | name          |
      | <inviter-role> | inviter-<run> |
      | <role-a>       | role-a-<run>  |
      | <role-b>       | role-b-<run>  |
    And the rows of directus_access:
      | id         | role           | policy           |
      | <access-1> | <inviter-role> | <inviter-policy> |
    And the rows of directus_users:
      | id          | email                       | token           |
      | <inviter-a> | inviter-a-<run>@example.com | inviter-a-<run> |
      | <inviter-b> | inviter-b-<run>@example.com | inviter-b-<run> |
    And the rows of directus_role_members:
      | id         | user        | role           | sort |
      | <member-1> | <inviter-a> | <inviter-role> | 1    |
      | <member-2> | <inviter-b> | <inviter-role> | 1    |
    Then these requests get these responses:
      | request                                       | response                   |
      | as: inviter-a-<run>                           | code: 204                  |+
      | method: POST                                  |                            |
      | path: /users/invite                           |                            |
      | payload:                                      |                            |
      |   email: to-<run>@example.com                 |                            |
      |   roles:                                      |                            |
      |     - <role-a>                                |                            |
      | as: inviter-a-<run>                           | code: 204                  |+
      | method: POST                                  |                            |
      | path: /users/invite                           |                            |
      | payload:                                      |                            |
      |   email: to-<run>@example.com                 |                            |
      |   roles:                                      |                            |
      |     - <role-b>                                |                            |
      | as: inviter-b-<run>                           | code: 204                  |+
      | method: POST                                  |                            |
      | path: /users/invite                           |                            |
      | payload:                                      |                            |
      |   email: to-<run>@example.com                 |                            |
      |   roles:                                      |                            |
      |     - <role-b>                                |                            |
      | method: GET                                   | code: 200                  |+
      | path: /users                                  | body:                      |
      | query:                                        |   data:                    |
      |   fields: roles.role,invites.role             |     - roles: []            |
      |   filter[email][_eq]: to-<run>@example.com    |       invites:             |
      |                                               |         - role: <role-b>   |
      |                                               |         - role: <role-b>   |
      | method: POST                                  | code: 204                  |+
      | path: /users/invite/accept                    |                            |
      | payload:                                      |                            |
      |   token: !jwt                                 |                            |
      |     email: to-<run>@example.com               |                            |
      |     scope: invite                             |                            |
      |   password: accepted-password                 |                            |
      | method: GET                                   | code: 200                  |+
      | path: /users                                  | body:                      |
      | query:                                        |   data:                    |
      |   fields: roles.role,roles.managed_by,invites |     - roles:               |
      |   filter[email][_eq]: to-<run>@example.com    |         - role: <role-b>   |
      |                                               |           managed_by: null |
      |                                               |       invites: []          |

  Scenario: an accepted invite gives its roles after the held ones, but one held by hand
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
      | <press> | press-<run> |
    And the rows of directus_users:
      | id      | email                   | status  |
      | <alice> | alice-<run>@example.com | invited |
    And the rows of directus_role_members:
      | id         | user    | role    | sort |
      | <member-1> | <alice> | <staff> | 1    |
    Then these requests get these responses:
      | request                                          | response                 |
      | method: POST                                     | code: 204                |+
      | path: /users/invite                              |                          |
      | payload:                                         |                          |
      |   email: alice-<run>@example.com                 |                          |
      |   roles:                                         |                          |
      |     - <press>                                    |                          |
      |     - <staff>                                    |                          |
      | method: POST                                     | code: 204                |+
      | path: /users/invite/accept                       |                          |
      | payload:                                         |                          |
      |   token: !jwt                                    |                          |
      |     email: alice-<run>@example.com               |                          |
      |     scope: invite                                |                          |
      |   password: accepted-password                    |                          |
      | method: GET                                      | code: 200                |+
      | path: /users/<alice>                             | body:                    |
      | query:                                           |   data:                  |
      |   fields: roles.role,roles.sort,roles.managed_by |     roles:               |
      |   deep: >-                                       |       - role: <staff>    |
      |     {"roles":{"_sort":["sort"]}}                 |         sort: 1          |
      |                                                  |         managed_by: null |
      |                                                  |       - role: <press>    |
      |                                                  |         sort: 2          |
      |                                                  |         managed_by: null |
      | method: PATCH                                    | code: 200                |+
      | path: /users/<alice>                             |                          |
      | payload:                                         |                          |
      |   roles: []                                      |                          |
      | method: GET                                      | code: 200                |+
      | path: /users/<alice>                             | body:                    |
      | query:                                           |   data:                  |
      |   fields: roles.role                             |     roles: []            |

  Scenario: an invite outlives its deleted inviter, naming no user
    Given the rows of directus_policies:
      | id        | name          | app_access | admin_access |
      | <inviter> | inviter-<run> | true       | true         |
    And the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
    And the rows of directus_users:
      | id      | email                   | token       | status  |
      | <alice> | alice-<run>@example.com | alice-<run> | active  |
      | <carol> | carol-<run>@example.com | carol-<run> | active  |
      | <bob>   | bob-<run>@example.com   | bob-<run>   | invited |
    And the rows of directus_access:
      | id         | user    | policy    |
      | <access-1> | <alice> | <inviter> |
      | <access-2> | <carol> | <inviter> |
    And the rows of directus_invites:
      | id         | user  | role    | user_created | date_created         |
      | <invite-1> | <bob> | <staff> | <alice>      | 2026-01-01T00:00:00Z |
      | <invite-2> | <bob> | <staff> | <carol>      | 2026-01-02T00:00:00Z |
    Then these requests get these responses:
      | request                                   | response                   |
      | method: DELETE                            | code: 204                  |+
      | path: /users/<alice>                      |                            |
      | method: DELETE                            | code: 204                  |+
      | path: /users/<carol>                      |                            |
      | method: GET                               | code: 200                  |+
      | path: /users/<bob>                        | body:                      |
      | query:                                    |   data:                    |
      |   fields: invites.id,invites.user_created |     invites:               |
      |   deep: >-                                |       - id: <invite-1>     |
      |     {"invites":{"_sort":                  |         user_created: null |
      |     ["date_created"]}}                    |                            |
      |                                           |       - id: <invite-2>     |
      |                                           |         user_created: null |
      | method: POST                              | code: 204                  |+
      | path: /users/invite/accept                |                            |
      | payload:                                  |                            |
      |   token: !jwt                             |                            |
      |     email: bob-<run>@example.com          |                            |
      |     scope: invite                         |                            |
      |   password: accepted-password             |                            |
      | method: GET                               | code: 200                  |+
      | path: /users/<bob>                        | body:                      |
      | query:                                    |   data:                    |
      |   fields: roles.role,invites              |     roles:                 |
      |                                           |       - role: <staff>      |
      |                                           |     invites: []            |

  Scenario: a user activated by a write of their status keeps their invites pending
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
    And the rows of directus_users:
      | id    | email                 | status  |
      | <bob> | bob-<run>@example.com | invited |
    And the rows of directus_invites:
      | id       | user  | role    | user_created |
      | <invite> | <bob> | <staff> | null         |
    Then these requests get these responses:
      | request                      | response              |
      | method: PATCH                | code: 200             |+
      | path: /users/<bob>           |                       |
      | payload:                     |                       |
      |   status: active             |                       |
      | method: GET                  | code: 200             |+
      | path: /users/<bob>           | body:                 |
      | query:                       |   data:               |
      |   fields: roles,invites.role |     roles: []         |
      |                              |     invites:          |
      |                              |       - role: <staff> |

  Scenario: a user who is no admin is refused a role write, whatever the permissions say
    Given the rows of directus_policies:
      | id         | name         | app_access | admin_access |
      | <p-writer> | writer-<run> | true       | false        |
    And the rows of directus_permissions:
      | policy     | collection            | action | fields |
      | <p-writer> | directus_users        | create | *      |
      | <p-writer> | directus_users        | update | *      |
      | <p-writer> | directus_role_members | create | *      |
      | <p-writer> | directus_role_members | update | *      |
      | <p-writer> | directus_role_members | delete | *      |
    And the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <writer> | writer-<run>@example.com | writer-<run> |
      | <target> | target-<run>@example.com | null         |
    And the rows of directus_access:
      | id         | user     | policy     |
      | <access-1> | <writer> | <p-writer> |
    Then these requests get these responses:
      | request                            | response                              |
      | as: writer-<run>                   | code: 403                             |+
      | method: PATCH                      | body:                                 |
      | path: /users/<target>              |   errors:                             |
      | payload:                           |     - message: >-                     |
      |   roles:                           |         You don't have permission     |
      |     - role: <staff>                |         to access this.               |
      | as: writer-<run>                   | code: 403                             |+
      | method: POST                       | body:                                 |
      | path: /users                       |   errors:                             |
      | payload:                           |     - message: >-                     |
      |   email: new-<run>@example.com     |         You don't have permission     |
      |   roles:                           |         to access this.               |
      |     - role: <staff>                |                                       |
      | method: GET                        | code: 200                             |+
      | path: /users                       | body:                                 |
      | query:                             |   data:                               |
      |   fields: email,roles,invites      |     - email: target-<run>@example.com |
      |   filter[email][_contains]: <run>  |       roles: []                       |
      |   sort: email                      |       invites: []                     |
      |                                    |     - email: writer-<run>@example.com |
      |                                    |       roles: []                       |
      |                                    |       invites: []                     |

  Scenario: a request setting managed_by is refused
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
    And the rows of directus_users:
      | id      | email                   |
      | <alice> | alice-<run>@example.com |
    Then these requests get these responses:
      | request                      | response                              |
      | method: PATCH                | code: 400                             |+
      | path: /users/<alice>         | body:                                 |
      | payload:                     |   errors:                             |
      |   roles:                     |     - message: >-                     |
      |     create:                  |         Invalid payload. "managed_by" |
      |       - role: <staff>        |         is set by the code managing   |
      |         managed_by: ext:sync |         the membership, not by a      |
      |                              |         request.                      |
      |                              |       extensions:                     |
      |                              |         code: INVALID_PAYLOAD         |
      | method: GET                  | code: 200                             |+
      | path: /users/<alice>         | body:                                 |
      | query:                       |   data:                               |
      |   fields: roles.role         |     roles: []                         |

  Scenario: an admin deletes a membership of a provider mapping no role
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
      | <board> | board-<run> |
    And the rows of directus_users:
      | id      | email                   |
      | <alice> | alice-<run>@example.com |
    And the rows of directus_role_members:
      | id         | user    | role    | managed_by   | sort |
      | <member-1> | <alice> | <staff> | auth:retired | 1    |
      | <member-2> | <alice> | <board> | ext:sync     | 2    |
    Then these requests get these responses:
      | request              | response                            |
      | method: PATCH        | code: 200                           |+
      | path: /users/<alice> |                                     |
      | payload:             |                                     |
      |   roles:             |                                     |
      |     delete:          |                                     |
      |       - <member-1>   |                                     |
      | method: PATCH        | code: 400                           |+
      | path: /users/<alice> | body:                               |
      | payload:             |   errors:                           |
      |   roles:             |     - message: >-                   |
      |     delete:          |         Invalid payload. Membership |
      |       - <member-2>   |         "<member-2>" is managed by  |
      |                      |         "ext:sync", which alone     |
      |                      |         changes it.                 |
      |                      |       extensions:                   |
      |                      |         code: INVALID_PAYLOAD       |
      | method: GET          | code: 200                           |+
      | path: /users/<alice> | body:                               |
      | query:               |   data:                             |
      |   fields: roles.role |     roles:                          |
      |                      |       - role: <board>               |

  Scenario: a role the user holds by hand is refused when given again by hand
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
    And the rows of directus_users:
      | id      | email                   |
      | <alice> | alice-<run>@example.com |
    And the rows of directus_role_members:
      | id         | user    | role    | sort |
      | <member-1> | <alice> | <staff> | 1    |
    Then these requests get these responses:
      | request                           | response                        |
      | method: PATCH                     | code: 400                       |+
      | path: /users/<alice>              | body:                           |
      | payload:                          |   errors:                       |
      |   roles:                          |     - message: >-               |
      |     create:                       |         Invalid payload. The    |
      |       - role: <staff>             |         user "<alice>" already  |
      |                                   |         holds the role          |
      |                                   |         "<staff>" with          |
      |                                   |         managed_by null.        |
      |                                   |       extensions:               |
      |                                   |         code: INVALID_PAYLOAD   |
      | method: GET                       | code: 200                       |+
      | path: /users/<alice>              | body:                           |
      | query:                            |   data:                         |
      |   fields: roles.role,roles.sort   |     roles:                      |
      |                                   |       - role: <staff>           |
      |                                   |         sort: 1                 |

  Scenario: a membership moved onto a role the user holds is refused
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
      | <press> | press-<run> |
    And the rows of directus_users:
      | id      | email                   |
      | <alice> | alice-<run>@example.com |
    And the rows of directus_role_members:
      | id          | user    | role    | sort |
      | <staff-row> | <alice> | <staff> | 1    |
      | <press-row> | <alice> | <press> | 2    |
    Then these requests get these responses:
      | request                           | response                        |
      | method: PATCH                     | code: 400                       |+
      | path: /users/<alice>              | body:                           |
      | payload:                          |   errors:                       |
      |   roles:                          |     - message: >-               |
      |     update:                       |         Invalid payload. The    |
      |       - id: <press-row>           |         user "<alice>" already  |
      |         role: <staff>             |         holds the role          |
      |                                   |         "<staff>" with          |
      |                                   |         managed_by null.        |
      |                                   |       extensions:               |
      |                                   |         code: INVALID_PAYLOAD   |
      | method: GET                       | code: 200                       |+
      | path: /users/<alice>              | body:                           |
      | query:                            |   data:                         |
      |   fields: roles.role,roles.sort   |     roles:                      |
      |   deep: >-                        |       - role: <staff>           |
      |     {"roles":{"_sort":["sort"]}}  |         sort: 1                 |
      |                                   |       - role: <press>           |
      |                                   |         sort: 2                 |

  Scenario: a membership handed to another user is refused, writing nothing
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
    And the rows of directus_users:
      | id      | email                   |
      | <alice> | alice-<run>@example.com |
      | <bob>   | bob-<run>@example.com   |
    And the rows of directus_role_members:
      | id          | user    | role    | sort |
      | <staff-row> | <alice> | <staff> | 1    |
    Then these requests get these responses:
      | request                    | response                                     |
      | method: PATCH              | code: 400                                    |+
      | path: /users/<alice>       | body:                                        |
      | payload:                   |   errors:                                    |
      |   roles:                   |     - message: >-                            |
      |     update:                |         Invalid payload. Membership          |
      |       - id: <staff-row>    |         "<staff-row>" gives role "<staff>"   |
      |         user: <bob>        |         to user "<alice>", which can't       |
      |                            |         change to "<bob>": delete it and     |
      |                            |         create one for that user.            |
      |                            |       extensions:                            |
      |                            |         code: INVALID_PAYLOAD                |
      | method: GET                | code: 200                                    |+
      | path: /users/<alice>       | body:                                        |
      | query:                     |   data:                                      |
      |   fields: roles.role       |     roles:                                   |
      |                            |       - role: <staff>                        |
      | method: GET                | code: 200                                    |+
      | path: /users/<bob>         | body:                                        |
      | query:                     |   data:                                      |
      |   fields: roles.role       |     roles: []                                |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_role_members | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 2      | 0      | 0      | 0      | 0    |

  Scenario: a membership sent back with its user changes its role
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
      | <press> | press-<run> |
    And the rows of directus_users:
      | id      | email                   |
      | <alice> | alice-<run>@example.com |
    And the rows of directus_role_members:
      | id          | user    | role    | sort |
      | <staff-row> | <alice> | <staff> | 1    |
    Then these requests get these responses:
      | request                        | response                     |
      | method: PATCH                  | code: 200                    |+
      | path: /users/<alice>           |                              |
      | payload:                       |                              |
      |   roles:                       |                              |
      |     update:                    |                              |
      |       - id: <staff-row>        |                              |
      |         user: <alice>          |                              |
      |         role: <press>          |                              |
      | method: GET                    | code: 200                    |+
      | path: /users/<alice>           | body:                        |
      | query:                         |   data:                      |
      |   fields: roles.id,roles.role  |     roles:                   |
      |                                |       - id: <staff-row>      |
      |                                |         role: <press>        |
