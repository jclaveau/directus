Feature: A user's role, status and deletion purge the cache as today

  - Pins what a user write purges once the memberships replace the role
    column (#746), and the statements it runs. A role change, or an invite
    into another role, sends no purged tags and the next read misses; a
    re-invite by the same inviter into the same role writes nothing. A user
    leaving `invited` purges the invite membership it keeps; an inviter's
    deletion drops the invite membership left without an invite, and flushes.
  - The feature runs against an instance of its own with the response cache
    on, in Redis, and `CACHE_AUTO_PURGE` scoped: a write names the pins it
    purged in `x-scoped-cache-purged-tags`, and a cached read tells a flush by
    its `x-cache-status`.
  - A Given states the database rows and the cached reads a scenario starts
    from; the rows are written straight into the database. A user's role is a
    `directus_role_members` row. An invited user is the rows `/users/invite`
    writes: a `directus_users` row with the `invited` status, a membership
    `managed_by: invite` per role, and the `directus_invites` row of each; a
    `user_created` of null names no inviter.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.
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
      | request | table                   | select | insert | update | delete | with |
      | 1       | directus_access         | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity       | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_revisions      | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members   | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_users          | 3      | 0      | 1      | 0      | 0    |
      | 2       | directus_users          | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_access         | 3      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity       | 0      | 3      | 0      | 0      | 0    |
      | 3       | directus_revisions      | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_role_members   | 4      | 1      | 0      | 1      | 0    |
      | 3       | directus_roles          | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_users          | 5      | 0      | 0      | 0      | 0    |
      | 4       | cache_user_rename_notes | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_access         | 4      | 0      | 0      | 0      | 0    |
      | 4       | directus_collections    | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_fields         | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_permissions    | 3      | 0      | 0      | 0      | 0    |
      | 4       | directus_policies       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_relations      | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_role_members   | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_roles          | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_users          | 1      | 0      | 0      | 0      | 0    |
      | 4       | geometry_columns        | 0      | 0      | 0      | 0      | 1    |
      | 4       | information_schema      | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_constraint           | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_index                | 2      | 0      | 0      | 0      | 0    |
      | 4       | pg_proc                 | 1      | 0      | 0      | 0      | 0    |

  Scenario: an invited user set active keeps their role and the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                     | status  |
      | <invitee> | invitee-<run>@example.com | invited |
    And the rows of directus_role_members:
      | id       | user      | role           | sort | managed_by |
      | <member> | <invitee> | <invitee-role> | 1    | invite     |
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
      |                                        |     directus_users:id=<invitee>,      |
      |                                        |     directus_role_members,            |
      |                                        |     directus_role_members:id=<member> |
      | method: GET                            | code: 200                             |+
      | path: /users/<invitee>                 | body:                                 |
      | query:                                 |   data:                               |
      |   fields: status,roles.role            |     status: active                    |
      |                                        |     roles:                            |
      |                                        |       - role: <invitee-role>          |
      | method: GET                            | code: 200                             |+
      | path: /items/cache_user_activate_notes | headers:                              |
      | query:                                 |   x-cache-status: HIT                 |
      |   fields: label                        |                                       |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 2      | 0      | 0      | 0      |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 1       | directus_users       | 3      | 0      | 1      | 0      |
      | 2       | directus_permissions | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 2      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |

  Scenario: a deleted inviter drops the invite membership and the cached read
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
      | <invitee-membership> | <invitee> | <invitee-role> | 1    | invite     |
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
      | request                              | response                           |
      | method: DELETE                       | code: 204                          |+
      | path: /users/<inviter>               | headers:                           |
      |                                      |   x-scoped-cache-purged-tags: null |
      | method: GET                          | code: 200                          |+
      | path: /items/cache_user_delete_notes | headers:                           |
      | query:                               |   x-cache-status: MISS             |
      |   fields: label                      |                                    |
    And on postgres the requests ran these statements:
      | request | table                  | select | insert | update | delete |
      | 1       | directus_access        | 1      | 0      | 0      | 0      |
      | 1       | directus_activity      | 0      | 1      | 0      | 0      |
      | 1       | directus_comments      | 1      | 0      | 0      | 0      |
      | 1       | directus_notifications | 1      | 0      | 0      | 0      |
      | 1       | directus_roles         | 1      | 0      | 0      | 0      |
      | 1       | directus_sessions      | 0      | 0      | 0      | 1      |
      | 1       | directus_users         | 2      | 0      | 0      | 1      |
      | 1       | directus_versions      | 1      | 0      | 0      | 0      |
      | 2       | directus_users         | 1      | 0      | 0      | 0      |

  Scenario: an invitation accepted with its token keeps the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                       | status  |
      | <invitee> | accepting-<run>@example.com | invited |
    And the rows of directus_role_members:
      | id       | user      | role           | sort | managed_by |
      | <member> | <invitee> | <invitee-role> | 1    | invite     |
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
      | request                                | response                              |
      | method: POST                           | code: 204                             |+
      | path: /users/invite/accept             | headers:                              |
      | payload:                               |   x-scoped-cache-purged-tags: >-      |
      |   token: !jwt                          |     directus_users,                   |
      |     email: accepting-<run>@example.com |     directus_users:id=<invitee>,      |
      |     scope: invite                      |     directus_role_members,            |
      |   password: accepted-password          |     directus_role_members:id=<member> |
      | method: GET                            | code: 200                             |+
      | path: /items/cache_user_accept_notes   | headers:                              |
      | query:                                 |   x-cache-status: HIT                 |
      |   fields: label                        |                                       |
    And on postgres the requests ran these statements:
      | request | table             | select | insert | update | delete |
      | 1       | directus_sessions | 0      | 0      | 0      | 1      |
      | 1       | directus_settings | 1      | 0      | 0      | 0      |
      | 1       | directus_users    | 2      | 0      | 1      | 0      |
      | 2       | directus_users    | 1      | 0      | 0      | 0      |

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
    And the rows of directus_role_members:
      | id           | user      | role        | sort | managed_by |
      | <membership> | <invitee> | <same-role> | 1    | invite     |
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
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 2      | 0      | 0      | 0      |
      | 2       | directus_users | 1      | 0      | 0      | 0      |

  Scenario: a pending invitee invited into a second role drops the cached read
    Given the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    And the rows of directus_users:
      | id        | email                    | status  |
      | <invitee> | second-<run>@example.com | invited |
    And the rows of directus_role_members:
      | id           | user      | role         | sort | managed_by |
      | <membership> | <invitee> | <first-role> | 1    | invite     |
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
      | request                              | response                           |
      | method: POST                         | code: 204                          |+
      | path: /users/invite                  | headers:                           |
      | payload:                             |   x-scoped-cache-purged-tags: null |
      |   email: second-<run>@example.com    |                                    |
      |   roles:                             |                                    |
      |     - <second-role>                  |                                    |
      | method: GET                          | code: 200                          |+
      | path: /users/<invitee>               | body:                              |
      | query:                               |   data:                            |
      |   fields: status,roles.role          |     status: invited                |
      |                                      |     roles:                         |
      |                                      |       - role: <first-role>         |
      |                                      |       - role: <second-role>        |
      | method: GET                          | code: 200                          |+
      | path: /items/cache_user_second_notes | headers:                           |
      | query:                               |   x-cache-status: MISS             |
      |   fields: label                      |                                    |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_invites        | 1      | 1      | 0      | 0      |
      | 1       | directus_role_members   | 1      | 1      | 0      | 0      |
      | 1       | directus_users          | 2      | 0      | 0      | 0      |
      | 2       | directus_access         | 4      | 0      | 0      | 0      |
      | 2       | directus_permissions    | 1      | 0      | 0      | 0      |
      | 2       | directus_policies       | 1      | 0      | 0      | 0      |
      | 2       | directus_role_members   | 2      | 0      | 0      | 0      |
      | 2       | directus_roles          | 1      | 0      | 0      | 0      |
      | 2       | directus_users          | 2      | 0      | 0      | 0      |
      | 3       | cache_user_second_notes | 1      | 0      | 0      | 0      |
      | 3       | directus_permissions    | 1      | 0      | 0      | 0      |
      | 3       | directus_users          | 1      | 0      | 0      | 0      |
