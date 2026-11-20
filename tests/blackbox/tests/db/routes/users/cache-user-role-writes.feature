Feature: A user's role, status and deletion purge the cache as today

  - Pins today's single-role contract (#746) before the memberships replace
    the role column: what a user write purges, and the statements it runs.
    A role change sends no purged tags: the mover's next read misses.
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
  - A header stated as a list matches its comma-separated values in any
    order: a user's deletion purges its cascades in no fixed order.

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
      | request                              | response                         |
      | method: PATCH                        | code: 200                        |+
      | path: /users/<mover>                 | headers:                         |
      | payload:                             |   x-scoped-cache-purged-tags: >- |
      |   first_name: renamed                |     directus_users,              |
      |                                      |     directus_users:id=<mover>    |
      | as: mover-<run>                      | code: 200                        |+
      | method: GET                          | headers:                         |
      | path: /items/cache_user_rename_notes |   x-cache-status: HIT            |
      | query:                               | body:                            |
      |   fields: label                      |   data:                          |
      |                                      |     - label: v1                  |
      | method: PATCH                        | code: 200                        |+
      | path: /users/<mover>                 |                                  |
      | payload:                             |                                  |
      |   role: <second-role>                |                                  |
      | as: mover-<run>                      | code: 200                        |+
      | method: GET                          | headers:                         |
      | path: /items/cache_user_rename_notes |   x-cache-status: MISS           |
      | query:                               | body:                            |
      |   fields: label                      |   data:                          |
      |                                      |     - label: v1                  |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete | with |
      | 1       | directus_access         | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity       | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_revisions      | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_users          | 3      | 0      | 1      | 0      | 0    |
      | 2       | directus_users          | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_access         | 3      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity       | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_revisions      | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_roles          | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_users          | 4      | 0      | 1      | 0      | 0    |
      | 4       | cache_user_rename_notes | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_access         | 4      | 0      | 0      | 0      | 0    |
      | 4       | directus_collections    | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_fields         | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_permissions    | 3      | 0      | 0      | 0      | 0    |
      | 4       | directus_policies       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_relations      | 1      | 0      | 0      | 0      | 0    |
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
      | request                                | response                         |
      | method: PATCH                          | code: 200                        |+
      | path: /users/<invitee>                 | headers:                         |
      | payload:                               |   x-scoped-cache-purged-tags: >- |
      |   status: active                       |     directus_users,              |
      |                                        |     directus_users:id=<invitee>  |
      | method: GET                            | code: 200                        |+
      | path: /users/<invitee>                 | body:                            |
      | query:                                 |   data:                          |
      |   fields: status,role                  |     status: active               |
      |                                        |     role: <invitee-role>         |
      | method: GET                            | code: 200                        |+
      | path: /items/cache_user_activate_notes | headers:                         |
      | query:                                 |   x-cache-status: HIT            |
      |   fields: label                        |                                  |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 2      | 0      | 0      | 0      |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 1       | directus_users       | 3      | 0      | 1      | 0      |
      | 2       | directus_permissions | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 2      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |

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
      | request                              | response                          |
      | method: DELETE                       | code: 204                         |+
      | path: /users/<inviter>               | headers:                          |
      |                                      |   x-scoped-cache-purged-tags:     |
      |                                      |     - directus_users              |
      |                                      |     - directus_users:id=<inviter> |
      |                                      |     - directus_presets            |
      |                                      |     - directus_sessions           |
      |                                      |     - directus_dashboards         |
      |                                      |     - directus_panels             |
      |                                      |     - directus_notifications      |
      |                                      |     - directus_shares             |
      |                                      |     - directus_flows              |
      |                                      |     - directus_operations         |
      |                                      |     - directus_versions           |
      |                                      |     - directus_comments           |
      |                                      |     - directus_access             |
      | method: GET                          | code: 200                         |+
      | path: /items/cache_user_delete_notes | headers:                          |
      | query:                               |   x-cache-status: HIT             |
      |   fields: label                      |                                   |
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
