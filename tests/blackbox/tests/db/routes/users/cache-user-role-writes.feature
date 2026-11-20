Feature: A user's role, status and deletion purge the cache as today

  - Pins today's single-role contract (#746) before the memberships replace
    the role column: what a user write purges, and the statements it runs.
  - The feature runs against an instance of its own with the response cache
    on, in Redis, and `CACHE_AUTO_PURGE` scoped: a write names the pins it
    purged in `x-scoped-cache-purged-tags`, and a cached read tells a flush by
    its `x-cache-status`.
  - A Given states the database rows and the cached reads a scenario starts
    from; the rows are written straight into the database. An invited user is
    the row `/users/invite` writes today: a `directus_users` row with the
    `invited` status and the role it names.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

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
      | id      | email                   | role         | token       |
      | <mover> | mover-<run>@example.com | <first-role> | mover-<run> |
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
      | request                              | response        |
      | method: PATCH                        | code: 200       |+
      | path: /users/<mover>                 |                 |
      | payload:                             |                 |
      |   first_name: renamed                |                 |
      | as: mover-<run>                      | code: 200       |+
      | method: GET                          | body:           |
      | path: /items/cache_user_rename_notes |   data:         |
      | query:                               |     - label: v1 |
      |   fields: label                      |                 |
      | method: PATCH                        | code: 200       |+
      | path: /users/<mover>                 |                 |
      | payload:                             |                 |
      |   role: <second-role>                |                 |
      | as: mover-<run>                      | code: 200       |+
      | method: GET                          | body:           |
      | path: /items/cache_user_rename_notes |   data:         |
      | query:                               |     - label: v1 |
      |   fields: label                      |                 |
    And on postgres the requests ran these statements:
      | request | table  | select | insert | update | delete |
      | 1       | (none) | 0      | 0      | 0      | 0      |
      | 2       | (none) | 0      | 0      | 0      | 0      |
      | 3       | (none) | 0      | 0      | 0      | 0      |
      | 4       | (none) | 0      | 0      | 0      | 0      |

  Scenario: an invited user set active keeps their role and the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                     | role           | status  |
      | <invitee> | invitee-<run>@example.com | <invitee-role> | invited |
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
      | request                                | response                 |
      | method: PATCH                          | code: 200                |+
      | path: /users/<invitee>                 |                          |
      | payload:                               |                          |
      |   status: active                       |                          |
      | method: GET                            | code: 200                |+
      | path: /users/<invitee>                 | body:                    |
      | query:                                 |   data:                  |
      |   fields: status,role                  |     status: active       |
      |                                        |     role: <invitee-role> |
      | method: GET                            | code: 200                |+
      | path: /items/cache_user_activate_notes |                          |
      | query:                                 |                          |
      |   fields: label                        |                          |
    And on postgres the requests ran these statements:
      | request | table  | select | insert | update | delete |
      | 1       | (none) | 0      | 0      | 0      | 0      |
      | 2       | (none) | 0      | 0      | 0      | 0      |
      | 3       | (none) | 0      | 0      | 0      | 0      |

  Scenario: a deleted inviter keeps the cached read
    Given the rows of directus_roles:
      | id             | name          |
      | <inviter-role> | inviter-<run> |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id        | email                     | role           | status  |
      | <inviter> | inviter-<run>@example.com | <inviter-role> | active  |
      | <invitee> | invitee-<run>@example.com | <invitee-role> | invited |
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
      | request                              | response  |
      | method: DELETE                       | code: 204 |+
      | path: /users/<inviter>               |           |
      | method: GET                          | code: 200 |+
      | path: /items/cache_user_delete_notes |           |
      | query:                               |           |
      |   fields: label                      |           |
    And on postgres the requests ran these statements:
      | request | table  | select | insert | update | delete |
      | 1       | (none) | 0      | 0      | 0      | 0      |
      | 2       | (none) | 0      | 0      | 0      | 0      |
