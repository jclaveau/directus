Feature: Only an admin or code writes who may do what

  - Access rows, policies and permissions, a role's parent and a user's role
    decide what a request may do. A request whose permissions grant it such a
    write is still refused unless it is an admin's: it could hand its author
    more than they hold (#763). Every other field stays the permissions' call.
  - An invitation is the one way a non-admin hands out a role: code writes
    the role of the user it invites, who cannot log in before accepting. A
    role that grants admin access, its own or a parent's, is an admin's to
    invite into.
  - A role a user belongs to is never deleted. An empty role's access rows
    and children's parent are cleaned up by code, whoever deletes the role.
  - A Given states the database rows a scenario starts from, written straight
    into the database. The writer's policy grants every action on the
    permission model.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a non-admin granted the permission model may write none of it
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <writer-policy> | writer-<run> | false      | false        |
      | <target-policy> | target-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection           | action | fields |
      | <writer-policy> | directus_access      | create | *      |
      | <writer-policy> | directus_access      | read   | *      |
      | <writer-policy> | directus_access      | update | *      |
      | <writer-policy> | directus_access      | delete | *      |
      | <writer-policy> | directus_policies    | create | *      |
      | <writer-policy> | directus_policies    | read   | *      |
      | <writer-policy> | directus_policies    | update | *      |
      | <writer-policy> | directus_policies    | delete | *      |
      | <writer-policy> | directus_permissions | create | *      |
      | <writer-policy> | directus_permissions | read   | *      |
      | <writer-policy> | directus_permissions | update | *      |
      | <writer-policy> | directus_permissions | delete | *      |
      | <writer-policy> | directus_roles       | create | *      |
      | <writer-policy> | directus_roles       | read   | *      |
      | <writer-policy> | directus_roles       | update | *      |
      | <writer-policy> | directus_roles       | delete | *      |
      | <writer-policy> | directus_users       | create | *      |
      | <writer-policy> | directus_users       | read   | *      |
      | <writer-policy> | directus_users       | update | *      |
      | <writer-policy> | directus_users       | delete | *      |
      | <target-policy> | directus_settings    | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <writer-role> | writer-<run> |
      | <target-role> | target-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <writer-access> | <writer-role> | <writer-policy> |
      | <target-access> | <target-role> | <target-policy> |
    And the rows of directus_users:
      | id       | email                    | role          | token        |
      | <writer> | writer-<run>@example.com | <writer-role> | writer-<run> |
      | <target> | target-<run>@example.com | <target-role> | null         |
    Then these requests get these responses:
      | request                         | response                          |
      | as: writer-<run>                | code: 403                         |+
      | method: POST                    | body:                             |
      | path: /access                   |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   role: <target-role>           |         You don't have permission |
      |   policy: <writer-policy>       |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: PATCH                   | body:                             |
      | path: /access/<target-access>   |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   policy: <writer-policy>       |         You don't have permission |
      |                                 |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: DELETE                  | body:                             |
      | path: /access/<target-access>   |   errors:                         |
      |                                 |     - message: >-                 |
      |                                 |         You don't have permission |
      |                                 |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: POST                    | body:                             |
      | path: /policies                 |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   name: grabbed-<run>           |         You don't have permission |
      |   admin_access: true            |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: PATCH                   | body:                             |
      | path: /policies/<target-policy> |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   admin_access: true            |         You don't have permission |
      |                                 |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: DELETE                  | body:                             |
      | path: /policies/<target-policy> |   errors:                         |
      |                                 |     - message: >-                 |
      |                                 |         You don't have permission |
      |                                 |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: POST                    | body:                             |
      | path: /permissions              |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   policy: <writer-policy>       |         You don't have permission |
      |   collection: directus_settings |         to access this.           |
      |   action: update                |                                   |
      |   fields: ['*']                 |                                   |
      | as: writer-<run>                | code: 403                         |+
      | method: PATCH                   | body:                             |
      | path: /permissions              |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   query:                        |         You don't have permission |
      |     filter:                     |         to access this.           |
      |       policy:                   |                                   |
      |         _eq: <target-policy>    |                                   |
      |   data:                         |                                   |
      |     action: update              |                                   |
      | as: writer-<run>                | code: 403                         |+
      | method: DELETE                  | body:                             |
      | path: /permissions              |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   query:                        |         You don't have permission |
      |     filter:                     |         to access this.           |
      |       policy:                   |                                   |
      |         _eq: <target-policy>    |                                   |
      | as: writer-<run>                | code: 403                         |+
      | method: POST                    | body:                             |
      | path: /roles                    |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   name: child-<run>             |         You don't have permission |
      |   parent: <target-role>         |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: PATCH                   | body:                             |
      | path: /roles/<writer-role>      |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   parent: <target-role>         |         You don't have permission |
      |                                 |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: PATCH                   | body:                             |
      | path: /roles/<target-role>      |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   policies:                     |         You don't have permission |
      |     create:                     |         to access this.           |
      |       - policy: <writer-policy> |                                   |
      | as: writer-<run>                | code: 403                         |+
      | method: POST                    | body:                             |
      | path: /users                    |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   email: made-<run>@example.com |         You don't have permission |
      |   role: <target-role>           |         to access this.           |
      | as: writer-<run>                | code: 403                         |+
      | method: PATCH                   | body:                             |
      | path: /users/<writer>           |   errors:                         |
      | payload:                        |     - message: >-                 |
      |   role: <target-role>           |         You don't have permission |
      |                                 |         to access this.           |
      | method: GET                     | code: 200                         |+
      | path: /roles/<writer-role>      | body:                             |
      | query:                          |   data:                           |
      |   fields: parent                |     parent: null                  |
      | method: GET                     | code: 200                         |+
      | path: /users/<writer>           | body:                             |
      | query:                          |   data:                           |
      |   fields: role                  |     role: <writer-role>           |
      | method: GET                     | code: 200                         |+
      | path: /access/<target-access>   | body:                             |
      | query:                          |   data:                           |
      |   fields: policy                |     policy: <target-policy>       |
      | method: GET                     | code: 200                         |+
      | path: /policies/<target-policy> | body:                             |
      | query:                          |   data:                           |
      |   fields: admin_access          |     admin_access: false           |
      | method: GET                     | code: 200                         |+
      | path: /permissions              | body:                             |
      | query:                          |   data:                           |
      |   filter:                       |     - action: read                |
      |     policy:                     |                                   |
      |       _eq: <target-policy>      |                                   |
      |   fields: action                |                                   |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions | 1      | 0      | 0      | 0      |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      |
      | 1       | directus_roles       | 1      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 0      | 0      | 0      | 0      |
      | 3       | directus_users       | 0      | 0      | 0      | 0      |
      | 4       | directus_users       | 0      | 0      | 0      | 0      |
      | 5       | directus_users       | 0      | 0      | 0      | 0      |
      | 6       | directus_users       | 0      | 0      | 0      | 0      |
      | 7       | directus_users       | 0      | 0      | 0      | 0      |
      | 8       | directus_users       | 0      | 0      | 0      | 0      |
      | 9       | directus_users       | 0      | 0      | 0      | 0      |
      | 10      | directus_users       | 0      | 0      | 0      | 0      |
      | 11      | directus_users       | 0      | 0      | 0      | 0      |
      | 12      | directus_users       | 0      | 0      | 0      | 0      |
      | 13      | directus_users       | 0      | 0      | 0      | 0      |
      | 14      | directus_users       | 0      | 0      | 0      | 0      |

  Scenario: a non-admin writes the model's other fields, an admin all of it
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <writer-policy> | writer-<run> | false      | false        |
      | <target-policy> | target-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection           | action | fields |
      | <writer-policy> | directus_access      | create | *      |
      | <writer-policy> | directus_access      | read   | *      |
      | <writer-policy> | directus_access      | update | *      |
      | <writer-policy> | directus_access      | delete | *      |
      | <writer-policy> | directus_policies    | create | *      |
      | <writer-policy> | directus_policies    | read   | *      |
      | <writer-policy> | directus_policies    | update | *      |
      | <writer-policy> | directus_policies    | delete | *      |
      | <writer-policy> | directus_permissions | create | *      |
      | <writer-policy> | directus_permissions | read   | *      |
      | <writer-policy> | directus_permissions | update | *      |
      | <writer-policy> | directus_permissions | delete | *      |
      | <writer-policy> | directus_roles       | create | *      |
      | <writer-policy> | directus_roles       | read   | *      |
      | <writer-policy> | directus_roles       | update | *      |
      | <writer-policy> | directus_roles       | delete | *      |
      | <writer-policy> | directus_users       | create | *      |
      | <writer-policy> | directus_users       | read   | *      |
      | <writer-policy> | directus_users       | update | *      |
      | <writer-policy> | directus_users       | delete | *      |
      | <target-policy> | directus_settings    | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <writer-role> | writer-<run> |
      | <target-role> | target-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <writer-access> | <writer-role> | <writer-policy> |
      | <target-access> | <target-role> | <target-policy> |
    And the rows of directus_users:
      | id       | email                    | role          | token        |
      | <writer> | writer-<run>@example.com | <writer-role> | writer-<run> |
      | <target> | target-<run>@example.com | <target-role> | null         |
    Then these requests get these responses:
      | request                         | response                          |
      | as: writer-<run>                | code: 200                         |+
      | method: PATCH                   | body:                             |
      | path: /roles/<writer-role>      |   data:                           |
      | payload:                        |     name: renamed-<run>           |
      |   name: renamed-<run>           |     parent: null                  |
      | as: writer-<run>                | code: 200                         |+
      | method: POST                    | body:                             |
      | path: /roles                    |   data:                           |
      | payload:                        |     name: child-<run>             |
      |   name: child-<run>             |     parent: null                  |
      |   parent: null                  |                                   |
      | as: writer-<run>                | code: 200                         |+
      | method: POST                    | body:                             |
      | path: /users                    |   data:                           |
      | payload:                        |     email: made-<run>@example.com |
      |   email: made-<run>@example.com |     role: null                    |
      | as: writer-<run>                | code: 200                         |+
      | method: PATCH                   | body:                             |
      | path: /users/<target>           |   data:                           |
      | payload:                        |     first_name: renamed           |
      |   first_name: renamed           |     role: <target-role>           |
      | method: PATCH                   | code: 200                         |+
      | path: /roles/<writer-role>      | body:                             |
      | payload:                        |   data:                           |
      |   parent: <target-role>         |     parent: <target-role>         |
      | method: POST                    | code: 200                         |+
      | path: /access                   | body:                             |
      | payload:                        |   data:                           |
      |   role: <writer-role>           |     role: <writer-role>           |
      |   policy: <target-policy>       |     policy: <target-policy>       |
      | method: PATCH                   | code: 200                         |+
      | path: /users/<writer>           | body:                             |
      | payload:                        |   data:                           |
      |   role: <target-role>           |     role: <target-role>           |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 5      | 0      | 0      | 0      |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      |
      | 1       | directus_permissions | 7      | 0      | 0      | 0      |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 1       | directus_roles       | 6      | 0      | 1      | 0      |
      | 1       | directus_users       | 3      | 0      | 0      | 0      |
      | 2       | directus_users       | 0      | 0      | 0      | 0      |
      | 3       | directus_users       | 0      | 0      | 0      | 0      |
      | 4       | directus_users       | 0      | 0      | 0      | 0      |
      | 5       | directus_users       | 0      | 0      | 0      | 0      |
      | 6       | directus_users       | 0      | 0      | 0      | 0      |
      | 7       | directus_users       | 0      | 0      | 0      | 0      |

  Scenario: a non-admin invites into a role, never into an admin one
    Given the rows of directus_policies:
      | id               | name          | app_access | admin_access |
      | <inviter-policy> | inviter-<run> | false      | false        |
      | <admin-policy>   | admin-<run>   | true       | true         |
    And the rows of directus_permissions:
      | policy           | collection     | action | fields |
      | <inviter-policy> | directus_users | create | *      |
      | <inviter-policy> | directus_users | read   | *      |
      | <inviter-policy> | directus_users | update | *      |
    And the rows of directus_roles:
      | id                 | name              | parent       |
      | <inviter-role>     | inviter-<run>     | null         |
      | <first-role>       | first-<run>       | null         |
      | <second-role>      | second-<run>      | null         |
      | <admin-role>       | admin-<run>       | null         |
      | <under-admin-role> | under-admin-<run> | <admin-role> |
    And the rows of directus_access:
      | id               | role           | policy           |
      | <inviter-access> | <inviter-role> | <inviter-policy> |
      | <admin-access>   | <admin-role>   | <admin-policy>   |
    And the rows of directus_users:
      | id        | email                     | role           | token         |
      | <inviter> | inviter-<run>@example.com | <inviter-role> | inviter-<run> |
    Then these requests get these responses:
      | request                            | response                                  |
      | as: inviter-<run>                  | code: 204                                 |+
      | method: POST                       |                                           |
      | path: /users/invite                |                                           |
      | payload:                           |                                           |
      |   email: invited-<run>@example.com |                                           |
      |   role: <first-role>               |                                           |
      | method: GET                        | code: 200                                 |+
      | path: /users                       | body:                                     |
      | query:                             |   data:                                   |
      |   fields: status,role              |     - status: invited                     |
      |   filter[email][_eq]: >-           |       role: <first-role>                  |
      |     invited-<run>@example.com      |                                           |
      | as: inviter-<run>                  | code: 204                                 |+
      | method: POST                       |                                           |
      | path: /users/invite                |                                           |
      | payload:                           |                                           |
      |   email: invited-<run>@example.com |                                           |
      |   role: <second-role>              |                                           |
      | method: GET                        | code: 200                                 |+
      | path: /users                       | body:                                     |
      | query:                             |   data:                                   |
      |   fields: status,role              |     - status: invited                     |
      |   filter[email][_eq]: >-           |       role: <second-role>                 |
      |     invited-<run>@example.com      |                                           |
      | as: inviter-<run>                  | code: 400                                 |+
      | method: POST                       | body:                                     |
      | path: /users/invite                |   errors:                                 |
      | payload:                           |     - message: >-                         |
      |   email: grabbed-<run>@example.com |         Invalid payload. Role             |
      |   role: <admin-role>               |         "<admin-role>" grants admin       |
      |                                    |         access: only an admin             |
      |                                    |         invites into it.                  |
      | as: inviter-<run>                  | code: 400                                 |+
      | method: POST                       | body:                                     |
      | path: /users/invite                |   errors:                                 |
      | payload:                           |     - message: >-                         |
      |   email: under-<run>@example.com   |         Invalid payload. Role             |
      |   role: <under-admin-role>         |         "<under-admin-role>" grants admin |
      |                                    |         access: only an admin             |
      |                                    |         invites into it.                  |
      | method: GET                        | code: 200                                 |+
      | path: /users                       | body:                                     |
      | query:                             |   data: []                                |
      |   fields: id                       |                                           |
      |   filter[email][_eq]: >-           |                                           |
      |     grabbed-<run>@example.com      |                                           |
      | method: GET                        | code: 200                                 |+
      | path: /users                       | body:                                     |
      | query:                             |   data: []                                |
      |   fields: id                       |                                           |
      |   filter[email][_eq]: >-           |                                           |
      |     under-<run>@example.com        |                                           |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete | with |
      | 1       | directus_access      | 5      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields      | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_relations   | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles       | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_users       | 4      | 1      | 1      | 0      | 0    |
      | 1       | geometry_columns     | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema   | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint        | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index             | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc              | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_users       | 0      | 0      | 0      | 0      | 0    |
      | 5       | directus_users       | 0      | 0      | 0      | 0      | 0    |
      | 6       | directus_users       | 0      | 0      | 0      | 0      | 0    |

  Scenario: a role a user belongs to stays, an empty one goes, by a non-admin too
    Given the rows of directus_policies:
      | id               | name          | app_access | admin_access |
      | <deleter-policy> | deleter-<run> | false      | false        |
      | <empty-policy>   | empty-<run>   | false      | false        |
    And the rows of directus_permissions:
      | policy           | collection     | action | fields |
      | <deleter-policy> | directus_roles | read   | *      |
      | <deleter-policy> | directus_roles | delete | *      |
    And the rows of directus_roles:
      | id             | name          | parent       |
      | <deleter-role> | deleter-<run> | null         |
      | <held-role>    | held-<run>    | null         |
      | <empty-role>   | empty-<run>   | null         |
      | <child-role>   | child-<run>   | <empty-role> |
    And the rows of directus_access:
      | id               | role           | policy           |
      | <deleter-access> | <deleter-role> | <deleter-policy> |
      | <empty-access>   | <empty-role>   | <empty-policy>   |
    And the rows of directus_users:
      | id        | email                     | role           | token         |
      | <deleter> | deleter-<run>@example.com | <deleter-role> | deleter-<run> |
      | <held>    | held-<run>@example.com    | <held-role>    | null          |
    Then these requests get these responses:
      | request                           | response                           |
      | method: DELETE                    | code: 400                          |+
      | path: /roles/<held-role>          | body:                              |
      |                                   |   errors:                          |
      |                                   |     - message: >-                  |
      |                                   |         Invalid payload. Role      |
      |                                   |         "<held-role>" can't be     |
      |                                   |         deleted while users belong |
      |                                   |         to it.                     |
      | as: deleter-<run>                 | code: 204                          |+
      | method: DELETE                    |                                    |
      | path: /roles/<empty-role>         |                                    |
      | method: GET                       | code: 200                          |+
      | path: /roles/<child-role>         | body:                              |
      | query:                            |   data:                            |
      |   fields: parent                  |     parent: null                   |
      | method: GET                       | code: 200                          |+
      | path: /access                     | body:                              |
      | query:                            |   data: []                         |
      |   fields: id                      |                                    |
      |   filter[role][_eq]: <empty-role> |                                    |
      | method: GET                       | code: 200                          |+
      | path: /users/<held>               | body:                              |
      | query:                            |   data:                            |
      |   fields: status,role             |     status: active                 |
      |                                   |     role: <held-role>              |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 2      | 0      | 0      | 0      |
      | 2       | directus_users | 0      | 0      | 0      | 0      |
