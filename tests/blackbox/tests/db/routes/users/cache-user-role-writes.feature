Feature: A user's role, status and deletion purge the cache as today

  - Pins today's single-role contract (#746) before the memberships replace
    the role column: what a user write purges, and the statements it runs.
  - The feature runs against an instance of its own with the response cache
    on, in Redis, and `CACHE_AUTO_PURGE` scoped: a write names the pins it
    purged in `x-scoped-cache-purged-tags`, and a cached read tells a flush by
    its `x-cache-status`.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the value a `remember` row stored.
    A response cell states the keys it checks.

  Scenario: a user's name change keeps the cached read, a role change drops it
    Given these requests are sent:
      | request                                   | response  |
      | method: POST                              | code: 200 |+
      | path: /collections                        |           |
      | payload:                                  |           |
      |   collection: cache_user_rename_notes     |           |
      |   schema: {}                              |           |
      |   meta: {}                                |           |
      |   fields:                                 |           |
      |     - field: label                        |           |
      |       type: string                        |           |
      |       meta: {}                            |           |
      | method: POST                              | code: 200 |+
      | path: /items/cache_user_rename_notes      |           |
      | payload:                                  |           |
      |   label: v1                               |           |
      | method: POST                              | code: 200 |+
      | path: /policies                           |           |
      | payload:                                  |           |
      |   id: <reader-policy>                     |           |
      |   name: reader-<run>                      |           |
      |   app_access: false                       |           |
      |   admin_access: false                     |           |
      |   permissions:                            |           |
      |     - collection: cache_user_rename_notes |           |
      |       action: read                        |           |
      |       fields: ['*']                       |           |
      | method: POST                              | code: 200 |+
      | path: /roles                              |           |
      | payload:                                  |           |
      |   id: <first-role>                        |           |
      |   name: first-<run>                       |           |
      |   policies:                               |           |
      |     - policy: <reader-policy>             |           |
      | method: POST                              | code: 200 |+
      | path: /roles                              |           |
      | payload:                                  |           |
      |   id: <second-role>                       |           |
      |   name: second-<run>                      |           |
      |   policies:                               |           |
      |     - policy: <reader-policy>             |           |
      | method: POST                              | code: 200 |+
      | path: /users                              |           |
      | payload:                                  |           |
      |   id: <mover>                             |           |
      |   email: mover-<run>@example.com          |           |
      |   role: <first-role>                      |           |
      |   token: mover-<run>                      |           |
    Then these requests get these responses:
    Then these requests get these responses:
      | request                              | response               |
      | as: mover-<run>                      | code: 200              |+
      | method: GET                          | headers:               |
      | path: /items/cache_user_rename_notes |   x-cache-status: MISS |
      | query:                               | body:                  |
      |   fields: label                      |   data:                |
      |                                      |     - label: v1        |
      | as: mover-<run>                      | code: 200              |+
      | method: GET                          | headers:               |
      | path: /items/cache_user_rename_notes |   x-cache-status: HIT  |
      | query:                               | body:                  |
      |   fields: label                      |   data:                |
      |                                      |     - label: v1        |
      | method: PATCH                        | code: 200              |+
      | path: /users/<mover>                 |                        |
      | payload:                             |                        |
      |   first_name: renamed                |                        |
      | as: mover-<run>                      | code: 200              |+
      | method: GET                          | body:                  |
      | path: /items/cache_user_rename_notes |   data:                |
      | query:                               |     - label: v1        |
      |   fields: label                      |                        |
      | method: PATCH                        | code: 200              |+
      | path: /users/<mover>                 |                        |
      | payload:                             |                        |
      |   role: <second-role>                |                        |
      | as: mover-<run>                      | code: 200              |+
      | method: GET                          | body:                  |
      | path: /items/cache_user_rename_notes |   data:                |
      | query:                               |     - label: v1        |
      |   fields: label                      |                        |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 3       | directus_users | 0      | 0      | 0      | 0      |
      | 5       | directus_users | 0      | 0      | 0      | 0      |

  Scenario: an invited user set active keeps their role and the cached read
    Given these requests are sent:
      | request                                 | response  |
      | method: POST                            | code: 200 |+
      | path: /collections                      |           |
      | payload:                                |           |
      |   collection: cache_user_activate_notes |           |
      |   schema: {}                            |           |
      |   meta: {}                              |           |
      |   fields:                               |           |
      |     - field: label                      |           |
      |       type: string                      |           |
      |       meta: {}                          |           |
      | method: POST                            | code: 200 |+
      | path: /items/cache_user_activate_notes  |           |
      | payload:                                |           |
      |   label: v1                             |           |
      | method: POST                            | code: 200 |+
      | path: /roles                            |           |
      | payload:                                |           |
      |   id: <invitee-role>                    |           |
      |   name: invitee-<run>                   |           |
      | method: POST                            | code: 204 |+
      | path: /users/invite                     |           |
      | payload:                                |           |
      |   email: invitee-<run>@example.com      |           |
      |   role: <invitee-role>                  |           |
      | method: GET                             | code: 200 |+
      | path: /users                            |           |
      | query:                                  |           |
      |   fields: id                            |           |
      |   filter[email][_eq]: >-                |           |
      |     invitee-<run>@example.com           |           |
      | remember:                               |           |
      |   invitee: body.data.0.id               |           |
    Then these requests get these responses:
      | request                                | response                 |
      | method: GET                            | code: 200                |+
      | path: /items/cache_user_activate_notes | headers:                 |
      | query:                                 |   x-cache-status: MISS   |
      |   fields: label                        |                          |
      | method: GET                            | code: 200                |+
      | path: /items/cache_user_activate_notes | headers:                 |
      | query:                                 |   x-cache-status: HIT    |
      |   fields: label                        |                          |
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
      | request | table          | select | insert | update | delete |
      | 3       | directus_users | 0      | 0      | 0      | 0      |

  Scenario: a deleted inviter keeps the cached read
    Given these requests are sent:
      | request                               | response  |
      | method: POST                          | code: 200 |+
      | path: /collections                    |           |
      | payload:                              |           |
      |   collection: cache_user_delete_notes |           |
      |   schema: {}                          |           |
      |   meta: {}                            |           |
      |   fields:                             |           |
      |     - field: label                    |           |
      |       type: string                    |           |
      |       meta: {}                        |           |
      | method: POST                          | code: 200 |+
      | path: /items/cache_user_delete_notes  |           |
      | payload:                              |           |
      |   label: v1                           |           |
      | method: POST                          | code: 200 |+
      | path: /policies                       |           |
      | payload:                              |           |
      |   id: <inviter-policy>                |           |
      |   name: inviter-<run>                 |           |
      |   app_access: false                   |           |
      |   admin_access: false                 |           |
      |   permissions:                        |           |
      |     - collection: directus_users      |           |
      |       action: create                  |           |
      |       fields: ['*']                   |           |
      | method: POST                          | code: 200 |+
      | path: /roles                          |           |
      | payload:                              |           |
      |   id: <inviter-role>                  |           |
      |   name: inviter-<run>                 |           |
      |   policies:                           |           |
      |     - policy: <inviter-policy>        |           |
      | method: POST                          | code: 200 |+
      | path: /roles                          |           |
      | payload:                              |           |
      |   id: <invitee-role>                  |           |
      |   name: invitee-<run>                 |           |
      | method: POST                          | code: 200 |+
      | path: /users                          |           |
      | payload:                              |           |
      |   id: <inviter>                       |           |
      |   email: inviter-<run>@example.com    |           |
      |   role: <inviter-role>                |           |
      |   token: inviter-<run>                |           |
      | as: inviter-<run>                     | code: 204 |+
      | method: POST                          |           |
      | path: /users/invite                   |           |
      | payload:                              |           |
      |   email: invitee-<run>@example.com    |           |
      |   role: <invitee-role>                |           |
    Then these requests get these responses:
      | request                              | response               |
      | method: GET                          | code: 200              |+
      | path: /items/cache_user_delete_notes | headers:               |
      | query:                               |   x-cache-status: MISS |
      |   fields: label                      |                        |
      | method: GET                          | code: 200              |+
      | path: /items/cache_user_delete_notes | headers:               |
      | query:                               |   x-cache-status: HIT  |
      |   fields: label                      |                        |
      | method: DELETE                       | code: 204              |+
      | path: /users/<inviter>               |                        |
      | method: GET                          | code: 200              |+
      | path: /items/cache_user_delete_notes |                        |
      | query:                               |                        |
      |   fields: label                      |                        |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 3       | directus_users | 0      | 0      | 0      | 0      |
