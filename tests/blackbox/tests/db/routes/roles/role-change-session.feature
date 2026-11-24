Feature: A role change reaches a static token and a session at once

  - A session token carries no role claim (#746, D3): every request, a static
    token's or a session's, reads the user's memberships, so a role change
    reaches a running session without a new login.
  - A request authenticates as the admin, unless it names the token it sends
    `as`; `remember_session: name` keeps the session token a login answered,
    which `<name>` stands for afterwards. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: a user moved to a role that cannot read stops reading in the session
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /collections                  |           |
      | payload:                            |           |
      |   collection: role_change_notes     |           |
      |   schema: {}                        |           |
      |   meta: {}                          |           |
      |   fields:                           |           |
      |     - field: label                  |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      | method: POST                        | code: 200 |+
      | path: /items/role_change_notes      |           |
      | payload:                            |           |
      |   label: v1                         |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <reader-policy>               |           |
      |   name: reader-<run>                |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: role_change_notes |           |
      |       action: read                  |           |
      |       fields: ['*']                 |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <reader-role>                 |           |
      |   name: reader-<run>                |           |
      |   policies:                         |           |
      |     - policy: <reader-policy>       |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <outsider-role>               |           |
      |   name: outsider-<run>              |           |
      | method: POST                        | code: 200 |+
      | path: /users                        |           |
      | payload:                            |           |
      |   id: <mover>                       |           |
      |   email: mover-<run>@example.com    |           |
      |   password: mover-password          |           |
      |   roles:                            |           |
      |     - role: <reader-role>           |           |
      |   token: mover-<run>                |           |
      | method: POST                        | code: 200 |+
      | path: /auth/login                   |           |
      | payload:                            |           |
      |   email: mover-<run>@example.com    |           |
      |   password: mover-password          |           |
      |   mode: session                     |           |
      | remember_session: old-session       |           |
    Then these requests get these responses:
      | request                          | response                           |
      | as: <old-session>                | code: 200                          |+
      | method: GET                      | body:                              |
      | path: /items/role_change_notes   |   data:                            |
      | query:                           |     - label: v1                    |
      |   fields: label                  |                                    |
      | method: PATCH                    | code: 200                          |+
      | path: /users/<mover>             |                                    |
      | payload:                         |                                    |
      |   roles:                         |                                    |
      |     - role: <outsider-role>      |                                    |
      | as: mover-<run>                  | code: 403                          |+
      | method: GET                      | body:                              |
      | path: /items/role_change_notes   |   errors:                          |
      | query:                           |     - message: >-                  |
      |   fields: label                  |         You don't have permission  |
      |                                  |         to access collection       |
      |                                  |         "role_change_notes" or it  |
      |                                  |         does not exist. Queried in |
      |                                  |         root.                      |
      | as: <old-session>                | code: 403                          |+
      | method: GET                      | body:                              |
      | path: /items/role_change_notes   |   errors:                          |
      | query:                           |     - message: >-                  |
      |   fields: label                  |         You don't have permission  |
      |                                  |         to access collection       |
      |                                  |         "role_change_notes" or it  |
      |                                  |         does not exist. Queried in |
      |                                  |         root.                      |
      | method: POST                     | code: 200                          |+
      | path: /auth/login                |                                    |
      | payload:                         |                                    |
      |   email: mover-<run>@example.com |                                    |
      |   password: mover-password       |                                    |
      |   mode: session                  |                                    |
      | remember_session: new-session    |                                    |
      | as: <new-session>                | code: 403                          |+
      | method: GET                      | body:                              |
      | path: /items/role_change_notes   |   errors:                          |
      | query:                           |     - message: >-                  |
      |   fields: label                  |         You don't have permission  |
      |                                  |         to access collection       |
      |                                  |         "role_change_notes" or it  |
      |                                  |         does not exist. Queried in |
      |                                  |         root.                      |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 1      | 0      | 0      | 0      |
      | 1       | directus_permissions  | 2      | 0      | 0      | 0      |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      |
      | 1       | directus_sessions     | 1      | 0      | 0      | 0      |
      | 1       | role_change_notes     | 1      | 0      | 0      | 0      |
      | 2       | directus_access       | 3      | 0      | 0      | 0      |
      | 2       | directus_activity     | 0      | 3      | 0      | 0      |
      | 2       | directus_invites      | 2      | 0      | 0      | 0      |
      | 2       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 2       | directus_role_members | 4      | 1      | 0      | 1      |
      | 2       | directus_roles        | 1      | 0      | 0      | 0      |
      | 2       | directus_users        | 5      | 0      | 0      | 0      |
      | 3       | directus_access       | 3      | 0      | 0      | 0      |
      | 3       | directus_permissions  | 1      | 0      | 0      | 0      |
      | 3       | directus_role_members | 1      | 0      | 0      | 0      |
      | 3       | directus_roles        | 1      | 0      | 0      | 0      |
      | 3       | directus_users        | 1      | 0      | 0      | 0      |
      | 4       | directus_sessions     | 1      | 0      | 0      | 0      |
      | 5       | directus_access       | 2      | 0      | 0      | 0      |
      | 5       | directus_activity     | 0      | 1      | 0      | 0      |
      | 5       | directus_role_members | 1      | 0      | 0      | 0      |
      | 5       | directus_roles        | 1      | 0      | 0      | 0      |
      | 5       | directus_sessions     | 0      | 1      | 0      | 1      |
      | 5       | directus_settings     | 1      | 0      | 0      | 0      |
      | 5       | directus_users        | 3      | 0      | 1      | 0      |
      | 6       | directus_sessions     | 1      | 0      | 0      | 0      |

  Scenario: a session refreshed after a role change takes the new role
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /collections                   |           |
      | payload:                             |           |
      |   collection: role_refresh_notes     |           |
      |   schema: {}                         |           |
      |   meta: {}                           |           |
      |   fields:                            |           |
      |     - field: label                   |           |
      |       type: string                   |           |
      |       meta: {}                       |           |
      | method: POST                         | code: 200 |+
      | path: /items/role_refresh_notes      |           |
      | payload:                             |           |
      |   label: v1                          |           |
      | method: POST                         | code: 200 |+
      | path: /policies                      |           |
      | payload:                             |           |
      |   id: <reader-policy>                |           |
      |   name: reader-<run>                 |           |
      |   app_access: false                  |           |
      |   admin_access: false                |           |
      |   permissions:                       |           |
      |     - collection: role_refresh_notes |           |
      |       action: read                   |           |
      |       fields: ['*']                  |           |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <reader-role>                  |           |
      |   name: reader-<run>                 |           |
      |   policies:                          |           |
      |     - policy: <reader-policy>        |           |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <outsider-role>                |           |
      |   name: outsider-<run>               |           |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   id: <mover>                        |           |
      |   email: refresher-<run>@example.com |           |
      |   password: mover-password           |           |
      |   roles:                             |           |
      |     - role: <reader-role>            |           |
      | method: POST                         | code: 200 |+
      | path: /auth/login                    |           |
      | payload:                             |           |
      |   email: refresher-<run>@example.com |           |
      |   password: mover-password           |           |
      |   mode: session                      |           |
      | remember_session: old-session        |           |
    Then these requests get these responses:
      | request                                  | response                           |
      | method: PATCH                            | code: 200                          |+
      | path: /users/<mover>                     |                                    |
      | payload:                                 |                                    |
      |   roles:                                 |                                    |
      |     - role: <outsider-role>              |                                    |
      | as: public                               | code: 200                          |+
      | method: POST                             |                                    |
      | path: /auth/refresh                      |                                    |
      | headers:                                 |                                    |
      |   Cookie: >-                             |                                    |
      |     directus_session_token=<old-session> |                                    |
      | payload:                                 |                                    |
      |   mode: session                          |                                    |
      | remember_session: new-session            |                                    |
      | as: <new-session>                        | code: 403                          |+
      | method: GET                              | body:                              |
      | path: /items/role_refresh_notes          |   errors:                          |
      | query:                                   |     - message: >-                  |
      |   fields: label                          |         You don't have permission  |
      |                                          |         to access collection       |
      |                                          |         "role_refresh_notes" or it |
      |                                          |         does not exist. Queried in |
      |                                          |         root.                      |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 3      | 0      | 0      |
      | 1       | directus_invites      | 2      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 4      | 1      | 0      | 1      |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 5      | 0      | 0      | 0      |
      | 2       | directus_access       | 2      | 0      | 0      | 0      |
      | 2       | directus_role_members | 1      | 0      | 0      | 0      |
      | 2       | directus_roles        | 1      | 0      | 0      | 0      |
      | 2       | directus_sessions     | 2      | 1      | 1      | 1      |
      | 2       | directus_users        | 0      | 0      | 1      | 0      |
      | 3       | directus_access       | 1      | 0      | 0      | 0      |
      | 3       | directus_permissions  | 1      | 0      | 0      | 0      |
      | 3       | directus_sessions     | 1      | 0      | 0      | 0      |
