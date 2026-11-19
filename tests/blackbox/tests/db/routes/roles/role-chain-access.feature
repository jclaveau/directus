Feature: A user holds one role and gets the policies of its whole parent chain

  - Pins today's single-role contract (#746): `directus_users.role` is one
    role, and the user gets that role's policies plus those of every parent
    above it. `/roles/me` lists every role of that chain, only their ids
    to a user who may not read the roles. GraphQL `roles_me` takes no
    argument and lists the chain by key: its scenario names both roles
    alike, so their order does not matter.
  - Admin and app access are recomputed on every request from the chain.
  - A user with no role is still logged in: the `/me` endpoints answer them,
    and refuse only a request sending no credentials (`as: public`).
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a user of a child role reads with the policy of the parent role
    Given these requests are sent:
      | request                                   | response  |
      | method: POST                              | code: 200 |+
      | path: /collections                        |           |
      | payload:                                  |           |
      |   collection: role_chain_parent_notes     |           |
      |   schema: {}                              |           |
      |   meta: {}                                |           |
      |   fields:                                 |           |
      |     - field: label                        |           |
      |       type: string                        |           |
      |       meta: {}                            |           |
      | method: POST                              | code: 200 |+
      | path: /items/role_chain_parent_notes      |           |
      | payload:                                  |           |
      |   label: read through the parent          |           |
      | method: POST                              | code: 200 |+
      | path: /policies                           |           |
      | payload:                                  |           |
      |   id: <parent-policy>                     |           |
      |   name: parent-<run>                      |           |
      |   app_access: true                        |           |
      |   admin_access: false                     |           |
      |   permissions:                            |           |
      |     - collection: role_chain_parent_notes |           |
      |       action: read                        |           |
      |       fields: ['*']                       |           |
      | method: POST                              | code: 200 |+
      | path: /roles                              |           |
      | payload:                                  |           |
      |   id: <parent-role>                       |           |
      |   name: parent-<run>                      |           |
      |   policies:                               |           |
      |     - policy: <parent-policy>             |           |
      | method: POST                              | code: 200 |+
      | path: /roles                              |           |
      | payload:                                  |           |
      |   id: <child-role>                        |           |
      |   name: child-<run>                       |           |
      |   parent: <parent-role>                   |           |
      | method: POST                              | code: 200 |+
      | path: /users                              |           |
      | payload:                                  |           |
      |   email: child-<run>@example.com          |           |
      |   roles:                                  |           |
      |     - role: <child-role>                  |           |
      |   token: child-<run>                      |           |
    Then these requests get these responses:
      | request                              | response                             |
      | as: child-<run>                      | code: 200                            |+
      | method: GET                          | body:                                |
      | path: /items/role_chain_parent_notes |   data:                              |
      | query:                               |     - label: read through the parent |
      |   fields: label                      |                                      |
      | as: child-<run>                      | code: 200                            |+
      | method: GET                          | body:                                |
      | path: /roles/me                      |   data:                              |
      | query:                               |     - name: child-<run>              |
      |   fields: name                       |     - name: parent-<run>             |
      |   sort: name                         |                                      |
      | as: child-<run>                      | code: 200                            |+
      | method: GET                          | body:                                |
      | path: /policies/me/globals           |   data:                              |
      |                                      |     app_access: true                 |
      |                                      |     admin_access: false              |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_access         | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions    | 2      | 0      | 0      | 0      |
      | 1       | directus_policies       | 1      | 0      | 0      | 0      |
      | 1       | directus_roles          | 2      | 0      | 0      | 0      |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | role_chain_parent_notes | 1      | 0      | 0      | 0      |
      | 2       | directus_permissions    | 1      | 0      | 0      | 0      |
      | 2       | directus_roles          | 1      | 0      | 0      | 0      |
      | 2       | directus_users          | 1      | 0      | 0      | 0      |
      | 3       | directus_policies       | 1      | 0      | 0      | 0      |
      | 3       | directus_users          | 1      | 0      | 0      | 0      |

  Scenario: a user of a child role is an admin when the parent role is
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /policies                  |           |
      | payload:                         |           |
      |   id: <admin-policy>             |           |
      |   name: admin-<run>              |           |
      |   app_access: true               |           |
      |   admin_access: true             |           |
      | method: POST                     | code: 200 |+
      | path: /roles                     |           |
      | payload:                         |           |
      |   id: <admin-role>               |           |
      |   name: admin-<run>              |           |
      |   policies:                      |           |
      |     - policy: <admin-policy>     |           |
      | method: POST                     | code: 200 |+
      | path: /roles                     |           |
      | payload:                         |           |
      |   id: <child-role>               |           |
      |   name: child-<run>              |           |
      |   parent: <admin-role>           |           |
      | method: POST                     | code: 200 |+
      | path: /users                     |           |
      | payload:                         |           |
      |   id: <child-user>               |           |
      |   email: child-<run>@example.com |           |
      |   roles:                         |           |
      |     - role: <child-role>         |           |
      |   token: child-<run>             |           |
    Then these requests get these responses:
      | request                    | response                   |
      | as: child-<run>            | code: 200                  |+
      | method: GET                | body:                      |
      | path: /policies/me/globals |   data:                    |
      |                            |     app_access: true       |
      |                            |     admin_access: true     |
      | as: child-<run>            | code: 200                  |+
      | method: GET                | body:                      |
      | path: /users/<child-user>  |   data:                    |
      | query:                     |     roles:                 |
      |   fields: roles.role       |       - role: <child-role> |
    And on postgres the requests ran these statements:
      | request | table             | select | insert | update | delete |
      | 1       | directus_access   | 3      | 0      | 0      | 0      |
      | 1       | directus_policies | 2      | 0      | 0      | 0      |
      | 1       | directus_roles    | 2      | 0      | 0      | 0      |
      | 1       | directus_users    | 1      | 0      | 0      | 0      |
      | 2       | directus_users    | 2      | 0      | 0      | 0      |

  Scenario: a user with no role reaches the me endpoints, no credentials do not
    Then these requests get these responses:
      | request                    | response                 |
      | as: NoRoleToken            | code: 200                |+
      | method: GET                | body:                    |
      | path: /roles/me            |   data: []               |
      | as: NoRoleToken            | code: 200                |+
      | method: GET                |                          |
      | path: /permissions/me      |                          |
      | as: NoRoleToken            | code: 200                |+
      | method: GET                | body:                    |
      | path: /policies/me/globals |   data:                  |
      |                            |     app_access: false    |
      |                            |     admin_access: false  |
      | as: public                 | code: 403                |+
      | method: GET                | body:                    |
      | path: /roles/me            |   errors:                |
      |                            |     - message: >-        |
      |                            |         Can't access /me |
      |                            |         without being    |
      |                            |         logged in        |
      | as: public                 | code: 403                |+
      | method: GET                | body:                    |
      | path: /permissions/me      |   errors:                |
      |                            |     - message: >-        |
      |                            |         Can't access /me |
      |                            |         without being    |
      |                            |         logged in        |
      | as: public                 | code: 200                |+
      | method: GET                | body:                    |
      | path: /policies/me/globals |   data:                  |
      |                            |     app_access: false    |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions | 1      | 0      | 0      | 0      |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | directus_permissions | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 3       | directus_policies    | 1      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | (none)               | 0      | 0      | 0      | 0      |
      | 5       | (none)               | 0      | 0      | 0      | 0      |
      | 6       | (none)               | 0      | 0      | 0      | 0      |

  Scenario: a user who cannot read the roles gets the ids of their chain
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /roles                     |           |
      | payload:                         |           |
      |   id: <parent-role>              |           |
      |   name: parent-<run>             |           |
      | method: POST                     | code: 200 |+
      | path: /roles                     |           |
      | payload:                         |           |
      |   id: <child-role>               |           |
      |   name: child-<run>              |           |
      |   parent: <parent-role>          |           |
      | method: POST                     | code: 200 |+
      | path: /users                     |           |
      | payload:                         |           |
      |   email: blind-<run>@example.com |           |
      |   roles:                         |           |
      |     - role: <child-role>         |           |
      |   token: blind-<run>             |           |
    Then these requests get these responses:
      | request         | response                |
      | as: blind-<run> | code: 200               |+
      | method: GET     | body:                   |
      | path: /roles/me |   data:                 |
      | query:          |     - id: <parent-role> |
      |   fields: name  |     - id: <child-role>  |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions | 1      | 0      | 0      | 0      |
      | 1       | directus_roles       | 2      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |

  Scenario: graphql lists the roles of the user's chain
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <app-policy>                 |           |
      |   name: app-<run>                  |           |
      |   app_access: true                 |           |
      |   admin_access: false              |           |
      | method: POST                       | code: 200 |+
      | path: /roles                       |           |
      | payload:                           |           |
      |   id: <parent-role>                |           |
      |   name: chain-<run>                |           |
      | method: POST                       | code: 200 |+
      | path: /roles                       |           |
      | payload:                           |           |
      |   id: <child-role>                 |           |
      |   name: chain-<run>                |           |
      |   parent: <parent-role>            |           |
      |   policies:                        |           |
      |     - policy: <app-policy>         |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   email: graphql-<run>@example.com |           |
      |   roles:                           |           |
      |     - role: <child-role>           |           |
      |   token: graphql-<run>             |           |
    Then these requests get these responses:
      | request                          | response                  |
      | as: graphql-<run>                | code: 200                 |+
      | method: POST                     | body:                     |
      | path: /graphql/system            |   data:                   |
      | payload:                         |     roles_me:             |
      |   query: '{ roles_me { name } }' |       - name: chain-<run> |
      |                                  |       - name: chain-<run> |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions | 5      | 0      | 0      | 0      |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      |
      | 1       | directus_roles       | 3      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
