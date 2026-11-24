Feature: A user's role, status and deletion purge the cache as today

  - Pins what a user write purges once the memberships replace the role
    column (#746), and the statements it runs. A role change sends no purged
    tags and the next read misses. An invite writes invites only, and keeps
    the cached read: a re-invite by the same inviter into the same role
    writes nothing, one by another inviter adds its own invite. Accepting
    turns the invites into memberships and flushes; a user leaving `invited`
    by a write of their status keeps their invites pending. An inviter's
    deletion leaves their invites, naming no user, and purges its own
    cascades: the cached read stays.
  - The feature runs against an instance of its own with the response cache
    on, in Redis, and `CACHE_AUTO_PURGE` scoped: a write names the pins it
    purged in `x-scoped-cache-purged-tags`, and a cached read tells a flush by
    its `x-cache-status`.
  - A Given states the database rows and the cached reads a scenario starts
    from; the rows are written straight into the database. A user's role is a
    `directus_role_members` row. An invited user is the rows `/users/invite`
    writes: a `directus_users` row with the `invited` status and a
    `directus_invites` row per role; a `user_created` of null names no
    inviter.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own; met first in a response, it stands for
    the uuid received there. A response cell states the keys it checks.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    invitation token it mails.
  - A header stated as a list matches its comma-separated values in any
    order: a user's deletion purges its cascades in no fixed order. A
    header stated as `null` is one the response does not send.

  Scenario: a user's name change keeps the cached read, a role change drops it
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection              | action | fields |
      | <reader-policy> | cache_user_rename_notes | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <first-access>  | <first-role>  | <reader-policy> |
      | <second-access> | <second-role> | <reader-policy> |
    And the rows of directus_users:
      | id      | email                   | token       |
      | <mover> | mover-<run>@example.com | mover-<run> |
    And the rows of directus_role_members:
      | id           | user    | role         | sort |
      | <membership> | <mover> | <first-role> | 1    |
    And the rows of cache_user_rename_notes:
      | label |
      | v1    |
    And this read is cached:
      | request                              | response              |
      | as: mover-<run>                      | code: 200             |+
      | method: GET                          | headers:              |
      | path: /items/cache_user_rename_notes |   x-cache-status: HIT |
      | query:                               | body:                 |
      |   fields: label                      |   data:               |
      |                                      |     - label: v1       |
    Then these requests get these responses:
      | request                              | response                           |
      | method: PATCH                        | code: 200                          |+
      | path: /users/<mover>                 | headers:                           |
      | payload:                             |   x-scoped-cache-purged-tags: >-   |
      |   first_name: renamed                |     directus_users,                |
      |                                      |     directus_users:id=<mover>      |
      | as: mover-<run>                      | code: 200                          |+
      | method: GET                          | headers:                           |
      | path: /items/cache_user_rename_notes |   x-cache-status: HIT              |
      | query:                               | body:                              |
      |   fields: label                      |   data:                            |
      |                                      |     - label: v1                    |
      | method: PATCH                        | code: 200                          |+
      | path: /users/<mover>                 | headers:                           |
      | payload:                             |   x-scoped-cache-purged-tags: null |
      |   roles:                             |                                    |
      |     - role: <second-role>            |                                    |
      | as: mover-<run>                      | code: 200                          |+
      | method: GET                          | headers:                           |
      | path: /items/cache_user_rename_notes |   x-cache-status: MISS             |
      | query:                               | body:                              |
      |   fields: label                      |   data:                            |
      |                                      |     - label: v1                    |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_access         | 2      | 0      | 0      | 0      |
      | 1       | directus_activity       | 0      | 1      | 0      | 0      |
      | 1       | directus_invites        | 2      | 0      | 0      | 0      |
      | 1       | directus_revisions      | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members   | 2      | 0      | 0      | 0      |
      | 1       | directus_users          | 3      | 0      | 1      | 0      |
      | 2       | directus_users          | 1      | 0      | 0      | 0      |
      | 3       | directus_access         | 3      | 0      | 0      | 0      |
      | 3       | directus_activity       | 0      | 3      | 0      | 0      |
      | 3       | directus_invites        | 2      | 0      | 0      | 0      |
      | 3       | directus_revisions      | 0      | 1      | 0      | 0      |
      | 3       | directus_role_members   | 4      | 1      | 0      | 1      |
      | 3       | directus_roles          | 1      | 0      | 0      | 0      |
      | 3       | directus_users          | 5      | 0      | 0      | 0      |
      | 4       | cache_user_rename_notes | 1      | 0      | 0      | 0      |
      | 4       | directus_access         | 4      | 0      | 0      | 0      |
      | 4       | directus_permissions    | 3      | 0      | 0      | 0      |
      | 4       | directus_policies       | 1      | 0      | 0      | 0      |
      | 4       | directus_role_members   | 1      | 0      | 0      | 0      |
      | 4       | directus_roles          | 1      | 0      | 0      | 0      |
      | 4       | directus_users          | 1      | 0      | 0      | 0      |

  Scenario: an invited user set active keeps their invites and the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                     | status  |
      | <invitee> | invitee-<run>@example.com | invited |
    And the rows of directus_invites:
      | id       | user      | role           | user_created |
      | <invite> | <invitee> | <invitee-role> | null         |
    And the rows of cache_user_activate_notes:
      | label |
      | v1    |
    And this read is cached:
      | request                                | response              |
      | method: GET                            | code: 200             |+
      | path: /items/cache_user_activate_notes | headers:              |
      | query:                                 |   x-cache-status: HIT |
      |   fields: label                        |                       |
    Then these requests get these responses:
      | request                                | response                              |
      | method: PATCH                          | code: 200                             |+
      | path: /users/<invitee>                 | headers:                              |
      | payload:                               |   x-scoped-cache-purged-tags: >-      |
      |   status: active                       |     directus_users,                   |
      |                                        |     directus_users:id=<invitee>       |
      | method: GET                            | code: 200                             |+
      | path: /users/<invitee>                 | body:                                 |
      | query:                                 |   data:                               |
      |   fields: status,roles,invites.role    |     status: active                    |
      |                                        |     roles: []                         |
      |                                        |     invites:                          |
      |                                        |       - role: <invitee-role>          |
      | method: GET                            | code: 200                             |+
      | path: /items/cache_user_activate_notes | headers:                              |
      | query:                                 |   x-cache-status: HIT                 |
      |   fields: label                        |                                       |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 2      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_invites      | 2      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 2      | 0      | 0      | 0      |
      | 1       | directus_users        | 3      | 0      | 1      | 0      |
      | 2       | directus_invites      | 1      | 0      | 0      | 0      |
      | 2       | directus_permissions  | 1      | 0      | 0      | 0      |
      | 2       | directus_role_members | 1      | 0      | 0      | 0      |
      | 2       | directus_users        | 2      | 0      | 0      | 0      |
      | 3       | directus_users        | 1      | 0      | 0      | 0      |

  Scenario: a deleted inviter leaves the invite and keeps the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <inviter-role> | inviter-<run> |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                     | status  |
      | <inviter> | inviter-<run>@example.com | active  |
      | <invitee> | invitee-<run>@example.com | invited |
    And the rows of directus_role_members:
      | id                   | user      | role           | sort | managed_by |
      | <inviter-membership> | <inviter> | <inviter-role> | 1    | null       |
    And the rows of directus_invites:
      | id       | user      | role           | user_created |
      | <invite> | <invitee> | <invitee-role> | <inviter>    |
    And the rows of cache_user_delete_notes:
      | label |
      | v1    |
    And this read is cached:
      | request                              | response              |
      | method: GET                          | code: 200             |+
      | path: /items/cache_user_delete_notes | headers:              |
      | query:                               |   x-cache-status: HIT |
      |   fields: label                      |                       |
    Then these requests get these responses:
      | request                                   | response                          |
      | method: DELETE                            | code: 204                         |+
      | path: /users/<inviter>                    | headers:                          |
      |                                           |   x-scoped-cache-purged-tags:     |
      |                                           |     - directus_users              |
      |                                           |     - directus_users:id=<inviter> |
      |                                           |     - directus_presets            |
      |                                           |     - directus_sessions           |
      |                                           |     - directus_dashboards         |
      |                                           |     - directus_panels             |
      |                                           |     - directus_notifications      |
      |                                           |     - directus_shares             |
      |                                           |     - directus_flows              |
      |                                           |     - directus_operations         |
      |                                           |     - directus_versions           |
      |                                           |     - directus_comments           |
      |                                           |     - directus_access             |
      |                                           |     - directus_role_members       |
      |                                           |     - directus_invites            |
      | method: GET                               | code: 200                         |+
      | path: /items/cache_user_delete_notes      | headers:                          |
      | query:                                    |   x-cache-status: HIT             |
      |   fields: label                           |                                   |
      | method: GET                               | code: 200                         |+
      | path: /users/<invitee>                    | body:                             |
      | query:                                    |   data:                           |
      |   fields: invites.id,invites.user_created |     invites:                      |
      |                                           |       - id: <invite>              |
      |                                           |         user_created: null        |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_access         | 1      | 0      | 0      | 0      |
      | 1       | directus_activity       | 0      | 1      | 0      | 0      |
      | 1       | directus_comments       | 1      | 0      | 0      | 0      |
      | 1       | directus_notifications  | 1      | 0      | 0      | 0      |
      | 1       | directus_roles          | 1      | 0      | 0      | 0      |
      | 1       | directus_sessions       | 0      | 0      | 0      | 1      |
      | 1       | directus_users          | 2      | 0      | 0      | 1      |
      | 1       | directus_versions       | 1      | 0      | 0      | 0      |

  Scenario: an accepted invitation grants its role and drops the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                       | status  |
      | <invitee> | accepting-<run>@example.com | invited |
    And the rows of directus_invites:
      | id       | user      | role           | user_created |
      | <invite> | <invitee> | <invitee-role> | null         |
    And the rows of cache_user_accept_notes:
      | label |
      | v1    |
    And this read is cached:
      | request                              | response              |
      | method: GET                          | code: 200             |+
      | path: /items/cache_user_accept_notes | headers:              |
      | query:                               |   x-cache-status: HIT |
      |   fields: label                      |                       |
    Then these requests get these responses:
      | request                                | response                     |
      | method: POST                           | code: 204                    |+
      | path: /users/invite/accept             |                              |
      | payload:                               |                              |
      |   token: !jwt                          |                              |
      |     email: accepting-<run>@example.com |                              |
      |     scope: invite                      |                              |
      |   password: accepted-password          |                              |
      | method: GET                            | code: 200                    |+
      | path: /items/cache_user_accept_notes   | headers:                     |
      | query:                                 |   x-cache-status: MISS       |
      |   fields: label                        |                              |
      | method: GET                            | code: 200                    |+
      | path: /users/<invitee>                 | body:                        |
      | query:                                 |   data:                      |
      |   fields: status,roles.role,invites    |     status: active           |
      |                                        |     roles:                   |
      |                                        |       - role: <invitee-role> |
      |                                        |     invites: []              |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_invites        | 1      | 0      | 0      | 1      |
      | 1       | directus_role_members   | 1      | 1      | 0      | 0      |
      | 1       | directus_sessions       | 0      | 0      | 0      | 1      |
      | 1       | directus_settings       | 1      | 0      | 0      | 0      |
      | 1       | directus_users          | 2      | 0      | 1      | 0      |
      | 2       | cache_user_accept_notes | 1      | 0      | 0      | 0      |
      | 2       | directus_access         | 4      | 0      | 0      | 0      |
      | 2       | directus_permissions    | 1      | 0      | 0      | 0      |
      | 2       | directus_policies       | 1      | 0      | 0      | 0      |
      | 2       | directus_role_members   | 1      | 0      | 0      | 0      |
      | 2       | directus_roles          | 1      | 0      | 0      | 0      |
      | 2       | directus_users          | 1      | 0      | 0      | 0      |

  Scenario: a user invited again into the same role keeps the cached read
    Given the rows of directus_policies:
      | id               | name          | app_access | admin_access |
      | <inviter-policy> | inviter-<run> | true       | true         |
    And the rows of directus_roles:
      | id          | name       |
      | <same-role> | same-<run> |
    And the rows of directus_users:
      | id        | email                     | status  | token         |
      | <inviter> | inviter-<run>@example.com | active  | inviter-<run> |
      | <invitee> | same-<run>@example.com    | invited | null          |
    And the rows of directus_access:
      | id               | user      | policy           |
      | <inviter-access> | <inviter> | <inviter-policy> |
    And the rows of directus_invites:
      | id       | user      | role        | user_created |
      | <invite> | <invitee> | <same-role> | <inviter>    |
    And the rows of cache_user_reinvite_notes:
      | label |
      | v1    |
    And this read is cached:
      | request                                | response              |
      | method: GET                            | code: 200             |+
      | path: /items/cache_user_reinvite_notes | headers:              |
      | query:                                 |   x-cache-status: HIT |
      |   fields: label                        |                       |
    Then these requests get these responses:
      | request                                | response                           |
      | as: inviter-<run>                      | code: 204                          |+
      | method: POST                           | headers:                           |
      | path: /users/invite                    |   x-scoped-cache-purged-tags: null |
      | payload:                               |                                    |
      |   email: same-<run>@example.com        |                                    |
      |   roles:                               |                                    |
      |     - <same-role>                      |                                    |
      | method: GET                            | code: 200                          |+
      | path: /items/cache_user_reinvite_notes | headers:                           |
      | query:                                 |   x-cache-status: HIT              |
      |   fields: label                        |                                    |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_invites      | 1      | 0      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 2      | 0      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |

  Scenario: a user invited again by another inviter keeps the cached read
    Given the rows of directus_roles:
      | id          | name        |
      | <same-role> | again-<run> |
    And the rows of directus_users:
      | id        | email                   | status  |
      | <invitee> | again-<run>@example.com | invited |
    And the rows of directus_invites:
      | id       | user      | role        | user_created | date_created         |
      | <invite> | <invitee> | <same-role> | null         | 2026-01-01T00:00:00Z |
    And the rows of cache_user_again_notes:
      | label |
      | v1    |
    And this read is cached:
      | request                             | response              |
      | method: GET                         | code: 200             |+
      | path: /items/cache_user_again_notes | headers:              |
      | query:                              |   x-cache-status: HIT |
      |   fields: label                     |                       |
    Then these requests get these responses:
      | request                             | response                                |
      | method: POST                        | code: 204                               |+
      | path: /users/invite                 | headers:                                |
      | payload:                            |   x-scoped-cache-purged-tags:           |
      |   email: again-<run>@example.com    |     - directus_invites                  |
      |   roles:                            |     - directus_invites:id=<new-invite>  |
      |     - <same-role>                   |                                         |
      | method: GET                         | code: 200                               |+
      | path: /items/cache_user_again_notes | headers:                                |
      | query:                              |   x-cache-status: HIT                   |
      |   fields: label                     |                                         |
      | method: POST                        | code: 200                               |+
      | path: /graphql/system               | body:                                   |
      | payload:                            |   data:                                 |
      |   query: >-                         |     invites:                            |
      |     { invites(                      |       - id: <invite>                    |
      |     filter: {user: {id: {_eq:       |       - id: <new-invite>                |
      |     "<invitee>"}}},                 |                                         |
      |     sort: ["date_created"])         |                                         |
      |     { id } }                        |                                         |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_access  | 1      | 0      | 0      | 0      |
      | 1       | directus_invites | 1      | 1      | 0      | 0      |
      | 1       | directus_roles   | 1      | 0      | 0      | 0      |
      | 1       | directus_users   | 2      | 0      | 0      | 0      |
      | 2       | directus_users   | 1      | 0      | 0      | 0      |
      | 3       | directus_invites | 1      | 0      | 0      | 0      |
      | 3       | directus_users   | 1      | 0      | 0      | 0      |

  Scenario: a pending invitee invited into a second role keeps the cached read
    Given the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    And the rows of directus_users:
      | id        | email                    | status  |
      | <invitee> | second-<run>@example.com | invited |
    And the rows of directus_invites:
      | id       | user      | role         | user_created |
      | <invite> | <invitee> | <first-role> | null         |
    And the rows of cache_user_second_notes:
      | label |
      | v1    |
    And this read is cached:
      | request                              | response              |
      | method: GET                          | code: 200             |+
      | path: /items/cache_user_second_notes | headers:              |
      | query:                               |   x-cache-status: HIT |
      |   fields: label                      |                       |
    Then these requests get these responses:
      | request                              | response                               |
      | method: POST                         | code: 204                              |+
      | path: /users/invite                  | headers:                               |
      | payload:                             |   x-scoped-cache-purged-tags:          |
      |   email: second-<run>@example.com    |     - directus_invites                 |
      |   roles:                             |     - directus_invites:id=<new-invite> |
      |     - <second-role>                  |                                        |
      | method: GET                          | code: 200                              |+
      | path: /items/cache_user_second_notes | headers:                               |
      | query:                               |   x-cache-status: HIT                  |
      |   fields: label                      |                                        |
      | method: GET                          | code: 200                              |+
      | path: /users/<invitee>               | body:                                  |
      | query:                               |   data:                                |
      |   fields: status,roles,invites.*     |     status: invited                    |
      |   deep: >-                           |     roles: []                          |
      |     {"invites":{"_sort":             |     invites:                           |
      |     ["date_created"]}}               |       - id: <invite>                   |
      |                                      |         role: <first-role>             |
      |                                      |       - id: <new-invite>               |
      |                                      |         role: <second-role>            |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 1      | 0      | 0      | 0      |
      | 1       | directus_invites      | 1      | 1      | 0      | 0      |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 2      | 0      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 3       | directus_invites      | 1      | 0      | 0      | 0      |
      | 3       | directus_role_members | 1      | 0      | 0      | 0      |
      | 3       | directus_users        | 2      | 0      | 0      | 0      |
