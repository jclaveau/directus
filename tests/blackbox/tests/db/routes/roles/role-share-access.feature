Feature: A share reads with its sender's role chain and its own

  - Pins today's single-role contract (#746). A share session reads what both
    its sender's role and the share's role may read, each with the roles
    above it: a share whose role reads nothing reads nothing, even when its
    sender may.
  - A request authenticates as the admin, unless it names the token it sends
    `as`; `remember_session: name` keeps the session token a login answered,
    which `<name>` stands for afterwards. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own, or for the key
    a `remember: name` row stored. A response cell states the keys it checks.

  Scenario: a share reads through the parent roles of its sender and its role
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /collections                 |           |
      | payload:                           |           |
      |   collection: role_share_notes     |           |
      |   schema: {}                       |           |
      |   meta: {}                         |           |
      |   fields:                          |           |
      |     - field: label                 |           |
      |       type: string                 |           |
      |       meta: {}                     |           |
      | method: POST                       | code: 200 |+
      | path: /items/role_share_notes      |           |
      | payload:                           |           |
      |   label: shared                    |           |
      | remember: note                     |           |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <sharer-policy>              |           |
      |   name: sharer-<run>               |           |
      |   app_access: false                |           |
      |   admin_access: false              |           |
      |   permissions:                     |           |
      |     - collection: role_share_notes |           |
      |       action: read                 |           |
      |       fields: ['*']                |           |
      |     - collection: role_share_notes |           |
      |       action: share                |           |
      |       fields: ['*']                |           |
      |     - collection: directus_shares  |           |
      |       action: create               |           |
      |       fields: ['*']                |           |
      |     - collection: directus_shares  |           |
      |       action: read                 |           |
      |       fields: ['*']                |           |
      | method: POST                       | code: 200 |+
      | path: /roles                       |           |
      | payload:                           |           |
      |   id: <parent-role>                |           |
      |   name: parent-<run>               |           |
      |   policies:                        |           |
      |     - policy: <sharer-policy>      |           |
      | method: POST                       | code: 200 |+
      | path: /roles                       |           |
      | payload:                           |           |
      |   id: <child-role>                 |           |
      |   name: child-<run>                |           |
      |   parent: <parent-role>            |           |
      | method: POST                       | code: 200 |+
      | path: /roles                       |           |
      | payload:                           |           |
      |   id: <outsider-role>              |           |
      |   name: outsider-<run>             |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   email: sharer-<run>@example.com  |           |
      |   roles:                           |           |
      |     - role: <child-role>           |           |
      |   token: sharer-<run>              |           |
    Then these requests get these responses:
      | request                              | response                           |
      | as: sharer-<run>                     | code: 200                          |+
      | method: POST                         |                                    |
      | path: /shares                        |                                    |
      | payload:                             |                                    |
      |   collection: role_share_notes       |                                    |
      |   item: '<note>'                     |                                    |
      |   role: <child-role>                 |                                    |
      | remember: child-share                |                                    |
      | as: sharer-<run>                     | code: 200                          |+
      | method: POST                         |                                    |
      | path: /shares                        |                                    |
      | payload:                             |                                    |
      |   collection: role_share_notes       |                                    |
      |   item: '<note>'                     |                                    |
      |   role: <outsider-role>              |                                    |
      | remember: outsider-share             |                                    |
      | as: public                           | code: 200                          |+
      | method: POST                         |                                    |
      | path: /shares/auth                   |                                    |
      | payload:                             |                                    |
      |   share: <child-share>               |                                    |
      |   mode: session                      |                                    |
      | remember_session: child-session      |                                    |
      | as: <child-session>                  | code: 200                          |+
      | method: GET                          | body:                              |
      | path: /items/role_share_notes/<note> |   data:                            |
      | query:                               |     label: shared                  |
      |   fields: label                      |                                    |
      | as: public                           | code: 200                          |+
      | method: POST                         |                                    |
      | path: /shares/auth                   |                                    |
      | payload:                             |                                    |
      |   share: <outsider-share>            |                                    |
      |   mode: session                      |                                    |
      | remember_session: outsider-session   |                                    |
      | as: <outsider-session>               | code: 403                          |+
      | method: GET                          | body:                              |
      | path: /items/role_share_notes/<note> |   errors:                          |
      | query:                               |     - message: >-                  |
      |   fields: label                      |         You don't have permission  |
      |                                      |         to access field "id" in    |
      |                                      |         collection                 |
      |                                      |         "role_share_notes" or it   |
      |                                      |         does not exist. Queried in |
      |                                      |         root.                      |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_permissions  | 6      | 0      | 0      | 0      |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      |
      | 1       | directus_shares       | 1      | 1      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | role_share_notes      | 1      | 0      | 0      | 0      |
      | 2       | directus_activity     | 0      | 1      | 0      | 0      |
      | 2       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 2       | directus_shares       | 1      | 1      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | role_share_notes      | 1      | 0      | 0      | 0      |
      | 3       | directus_sessions     | 0      | 1      | 0      | 1      |
      | 3       | directus_shares       | 1      | 0      | 1      | 0      |
      | 4       | directus_access       | 4      | 0      | 0      | 0      |
      | 4       | directus_permissions  | 3      | 0      | 0      | 0      |
      | 4       | directus_policies     | 2      | 0      | 0      | 0      |
      | 4       | directus_sessions     | 1      | 0      | 0      | 0      |
      | 4       | directus_shares       | 1      | 0      | 0      | 0      |
      | 4       | directus_users        | 1      | 0      | 0      | 0      |
      | 4       | role_share_notes      | 1      | 0      | 0      | 0      |
      | 5       | directus_sessions     | 0      | 1      | 0      | 1      |
      | 5       | directus_shares       | 1      | 0      | 1      | 0      |
      | 6       | directus_access       | 2      | 0      | 0      | 0      |
      | 6       | directus_permissions  | 2      | 0      | 0      | 0      |
      | 6       | directus_roles        | 1      | 0      | 0      | 0      |
      | 6       | directus_sessions     | 1      | 0      | 0      | 0      |
      | 6       | directus_shares       | 1      | 0      | 0      | 0      |
      | 6       | directus_users        | 1      | 0      | 0      | 0      |

  Scenario: a refreshed share session keeps reading with the share's role
    Given these requests are sent:
      | request                                    | response  |
      | method: POST                               | code: 200 |+
      | path: /collections                         |           |
      | payload:                                   |           |
      |   collection: role_share_refresh_notes     |           |
      |   schema: {}                               |           |
      |   meta: {}                                 |           |
      |   fields:                                  |           |
      |     - field: label                         |           |
      |       type: string                         |           |
      |       meta: {}                             |           |
      | method: POST                               | code: 200 |+
      | path: /items/role_share_refresh_notes      |           |
      | payload:                                   |           |
      |   label: shared                            |           |
      | remember: note                             |           |
      | method: POST                               | code: 200 |+
      | path: /policies                            |           |
      | payload:                                   |           |
      |   id: <reader-policy>                      |           |
      |   name: reader-<run>                       |           |
      |   app_access: false                        |           |
      |   admin_access: false                      |           |
      |   permissions:                             |           |
      |     - collection: role_share_refresh_notes |           |
      |       action: read                         |           |
      |       fields: ['*']                        |           |
      | method: POST                               | code: 200 |+
      | path: /roles                               |           |
      | payload:                                   |           |
      |   id: <reader-role>                        |           |
      |   name: reader-<run>                       |           |
      |   policies:                                |           |
      |     - policy: <reader-policy>              |           |
      | method: POST                               | code: 200 |+
      | path: /shares                              |           |
      | payload:                                   |           |
      |   id: <share>                              |           |
      |   collection: role_share_refresh_notes     |           |
      |   item: '<note>'                           |           |
      |   role: <reader-role>                      |           |
      | method: POST                               | code: 200 |+
      | path: /shares/auth                         |           |
      | as: public                                 |           |
      | payload:                                   |           |
      |   share: <share>                           |           |
      |   mode: session                            |           |
      | remember_session: share-session            |           |
    Then these requests get these responses:
      | request                                      | response          |
      | as: public                                   | code: 200         |+
      | method: POST                                 |                   |
      | path: /auth/refresh                          |                   |
      | headers:                                     |                   |
      |   Cookie: >-                                 |                   |
      |     directus_session_token=<share-session>   |                   |
      | payload:                                     |                   |
      |   mode: session                              |                   |
      | remember_session: refreshed-session          |                   |
      | as: <refreshed-session>                      | code: 200         |+
      | method: GET                                  | body:             |
      | path: /items/role_share_refresh_notes/<note> |   data:           |
      | query:                                       |     label: shared |
      |   fields: label                              |                   |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_access          | 2      | 0      | 0      | 0      |
      | 1       | directus_sessions        | 2      | 1      | 1      | 1      |
      | 2       | directus_access          | 4      | 0      | 0      | 0      |
      | 2       | directus_permissions     | 6      | 0      | 0      | 0      |
      | 2       | directus_policies        | 3      | 0      | 0      | 0      |
      | 2       | directus_roles           | 1      | 0      | 0      | 0      |
      | 2       | directus_sessions        | 1      | 0      | 0      | 0      |
      | 2       | directus_shares          | 1      | 0      | 0      | 0      |
      | 2       | directus_users           | 1      | 0      | 0      | 0      |
      | 2       | role_share_refresh_notes | 1      | 0      | 0      | 0      |
