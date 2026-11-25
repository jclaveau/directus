Feature: A user's role, status and deletion purge the cache as today

  - Pins what a user write purges once the memberships replace the role
    column (#746), and the statements it runs. A role change sends no purged
    tags and the next read misses. An invite writes invites only, and keeps
    the cached read: a re-invite by the same inviter into the same role
    writes nothing, one by another inviter adds its own invite. Accepting
    turns the invites into memberships and flushes; an account created by a
    write for an invited email keeps its invites pending. An inviter's
    deletion leaves their invites, naming no inviter, and purges its own
    cascades: the cached read stays.
  - The feature runs against an instance of its own with the response cache
    on, in Redis, and `CACHE_AUTO_PURGE` scoped: a write names the pins it
    purged in `x-scoped-cache-purged-tags`, and a cached read tells a flush by
    its `x-cache-status`.
  - A Given states the database rows and the cached reads a scenario starts
    from; the rows are written straight into the database. A user's role is a
    `directus_role_members` row. An invitation is the rows `/users/invite`
    writes: a `directus_invites` row per email and role, read through the
    graphql `invites` query; an `inviter` of null names no inviter.
  - A request authenticates as the admin, unless it names the token it sends
    `as`; `as: public` sends none. `<run>` stands for a value unique to the
    scenario, and any other `<name>` for a uuid of its own; met first in a
    response, it stands for the uuid received there. A response cell states
    the keys it checks.
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
      | 1       | directus_revisions      | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members   | 2      | 0      | 0      | 0      |
      | 1       | directus_users          | 3      | 0      | 1      | 0      |
      | 2       | directus_users          | 1      | 0      | 0      | 0      |
      | 3       | directus_access         | 3      | 0      | 0      | 0      |
      | 3       | directus_activity       | 0      | 3      | 0      | 0      |
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

  Scenario: an account created for an invited email keeps its invites and the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_invites:
      | id       | email                     | role           | inviter |
      | <invite> | invitee-<run>@example.com | <invitee-role> | null    |
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
      | request                                | response                     |
      | method: POST                           | code: 200                    |+
      | path: /users                           | body:                        |
      | payload:                               |   data:                      |
      |   email: invitee-<run>@example.com     |     roles: []                |
      | method: POST                           | code: 200                    |+
      | path: /graphql/system                  | body:                        |
      | payload:                               |   data:                      |
      |   query: >-                            |     invites:                 |
      |     { invites(filter:                  |       - id: <invite>         |
      |     {email: {_eq:                      |         role:                |
      |     "invitee-<run>@example.com"}})     |           id: <invitee-role> |
      |     { id role { id } } }               |                              |
      | method: GET                            | code: 200                    |+
      | path: /items/cache_user_activate_notes | headers:                     |
      | query:                                 |   x-cache-status: HIT        |
      |   fields: label                        |                              |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 1      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 3      | 1      | 0      | 0      |
      | 2       | directus_invites      | 1      | 0      | 0      | 0      |
      | 2       | directus_roles        | 1      | 0      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 3       | directus_users        | 1      | 0      | 0      | 0      |

  Scenario: a deleted inviter leaves the invite and keeps the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <inviter-role> | inviter-<run> |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                     | status |
      | <inviter> | inviter-<run>@example.com | active |
    And the rows of directus_role_members:
      | id       | user      | role           | sort | managed_by |
      | <member> | <inviter> | <inviter-role> | 1    | null       |
    And the rows of directus_invites:
      | id       | email                     | role           | inviter   |
      | <invite> | invitee-<run>@example.com | <invitee-role> | <inviter> |
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
      | request                              | response                               |
      | method: DELETE                       | code: 204                              |+
      | path: /users/<inviter>               | headers:                               |
      |                                      |   x-scoped-cache-purged-tags: >-       |
      |                                      |     directus_users,                    |
      |                                      |     directus_users:id=<inviter>,       |
      |                                      |     directus_role_members,             |
      |                                      |     directus_role_members:id=<member>, |
      |                                      |     directus_invites,                  |
      |                                      |     directus_invites:id=<invite>       |
      | method: GET                          | code: 200                              |+
      | path: /items/cache_user_delete_notes | headers:                               |
      | query:                               |   x-cache-status: HIT                  |
      |   fields: label                      |                                        |
      | method: POST                         | code: 200                              |+
      | path: /graphql/system                | body:                                  |
      | payload:                             |   data:                                |
      |   query: >-                          |     invites:                           |
      |     { invites(filter:                |       - id: <invite>                   |
      |     {email: {_eq:                    |         inviter: null                  |
      |     "invitee-<run>@example.com"}})   |                                        |
      |     { id inviter { id } } }          |                                        |
    And on postgres the requests ran these statements:
      | request | table                  | select | insert | update | delete |
      | 1       | directus_access        | 2      | 0      | 0      | 0      |
      | 1       | directus_activity      | 0      | 1      | 0      | 0      |
      | 1       | directus_comments      | 2      | 0      | 0      | 0      |
      | 1       | directus_dashboards    | 1      | 0      | 0      | 0      |
      | 1       | directus_flows         | 1      | 0      | 0      | 0      |
      | 1       | directus_invites       | 2      | 0      | 0      | 0      |
      | 1       | directus_notifications | 2      | 0      | 0      | 0      |
      | 1       | directus_operations    | 1      | 0      | 0      | 0      |
      | 1       | directus_panels        | 1      | 0      | 0      | 0      |
      | 1       | directus_presets       | 1      | 0      | 0      | 0      |
      | 1       | directus_role_members  | 1      | 0      | 0      | 0      |
      | 1       | directus_roles         | 1      | 0      | 0      | 0      |
      | 1       | directus_sessions      | 1      | 0      | 0      | 1      |
      | 1       | directus_shares        | 1      | 0      | 0      | 0      |
      | 1       | directus_users         | 3      | 0      | 0      | 1      |
      | 1       | directus_versions      | 2      | 0      | 0      | 0      |
      | 3       | directus_invites       | 1      | 0      | 0      | 0      |

  Scenario: an accepted invitation grants its role and drops the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_invites:
      | id       | email                       | role           | inviter |
      | <invite> | accepting-<run>@example.com | <invitee-role> | null    |
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
      | request                                | response                       |
      | as: public                             | code: 204                      |+
      | method: POST                           |                                |
      | path: /users/invite/accept             |                                |
      | payload:                               |                                |
      |   token: !jwt                          |                                |
      |     email: accepting-<run>@example.com |                                |
      |     scope: invite                      |                                |
      |   password: accepted-password          |                                |
      | method: GET                            | code: 200                      |+
      | path: /items/cache_user_accept_notes   | headers:                       |
      | query:                                 |   x-cache-status: MISS         |
      |   fields: label                        |                                |
      | method: GET                            | code: 200                      |+
      | path: /users                           | body:                          |
      | query:                                 |   data:                        |
      |   fields: status,roles.role            |     - status: active           |
      |   filter[email][_eq]: >-               |       roles:                   |
      |     accepting-<run>@example.com        |         - role: <invitee-role> |
      | method: POST                           | code: 200                      |+
      | path: /graphql/system                  | body:                          |
      | payload:                               |   data:                        |
      |   query: >-                            |     invites: []                |
      |     { invites(filter:                  |                                |
      |     {email: {_eq:                      |                                |
      |     "accepting-<run>@example.com"}})   |                                |
      |     { id } }                           |                                |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_invites        | 1      | 0      | 0      | 1      |
      | 1       | directus_role_members   | 1      | 1      | 0      | 0      |
      | 1       | directus_settings       | 1      | 0      | 0      | 0      |
      | 1       | directus_users          | 2      | 1      | 0      | 0      |
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
      | id        | email                     | token         |
      | <inviter> | inviter-<run>@example.com | inviter-<run> |
    And the rows of directus_access:
      | id               | user      | policy           |
      | <inviter-access> | <inviter> | <inviter-policy> |
    And the rows of directus_invites:
      | id       | email                  | role        | inviter   |
      | <invite> | same-<run>@example.com | <same-role> | <inviter> |
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
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |

  Scenario: a user invited again by another inviter keeps the cached read
    Given the rows of directus_roles:
      | id          | name        |
      | <same-role> | again-<run> |
    And the rows of directus_invites:
      | id       | email                   | role        | inviter | date_created |
      | <invite> | again-<run>@example.com | <same-role> | null    | 2026-01-01   |
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
      |     { invites(filter:               |       - id: <invite>                    |
      |     {email: {_eq:                   |       - id: <new-invite>                |
      |     "again-<run>@example.com"}},    |                                         |
      |     sort: ["date_created"])         |                                         |
      |     { id } }                        |                                         |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_access  | 1      | 0      | 0      | 0      |
      | 1       | directus_invites | 1      | 1      | 0      | 0      |
      | 1       | directus_roles   | 1      | 0      | 0      | 0      |
      | 1       | directus_users   | 1      | 0      | 0      | 0      |
      | 2       | directus_users   | 1      | 0      | 0      | 0      |
      | 3       | directus_invites | 1      | 0      | 0      | 0      |
      | 3       | directus_users   | 1      | 0      | 0      | 0      |

  Scenario: a pending invitee invited into a second role keeps the cached read
    Given the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    And the rows of directus_invites:
      | id       | email                    | role         | inviter | date_created |
      | <invite> | second-<run>@example.com | <first-role> | null    | 2026-01-01   |
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
      | method: POST                         | code: 200                              |+
      | path: /graphql/system                | body:                                  |
      | payload:                             |   data:                                |
      |   query: >-                          |     invites:                           |
      |     { invites(filter:                |       - id: <invite>                   |
      |     {email: {_eq:                    |         role:                          |
      |     "second-<run>@example.com"}},    |           id: <first-role>             |
      |     sort: ["date_created"])          |       - id: <new-invite>               |
      |     { id role { id } } }             |         role:                          |
      |                                      |           id: <second-role>            |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_access  | 1      | 0      | 0      | 0      |
      | 1       | directus_invites | 1      | 1      | 0      | 0      |
      | 1       | directus_roles   | 1      | 0      | 0      | 0      |
      | 1       | directus_users   | 1      | 0      | 0      | 0      |
      | 2       | directus_users   | 1      | 0      | 0      | 0      |
      | 3       | directus_invites | 1      | 0      | 0      | 0      |
      | 3       | directus_roles   | 1      | 0      | 0      | 0      |
      | 3       | directus_users   | 1      | 0      | 0      | 0      |
