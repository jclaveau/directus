Feature: A single permission reaches its policy's users from the next request on

  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.

  Scenario: a permission created, narrowed and deleted reaches its user at once
    Given these requests are sent:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /items/test_singular_permissions |           |
      | payload:                               |           |
      |   name: <run>                          |           |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <reader-policy>                  |           |
      |   name: reader-<run>                   |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   email: reader-<run>@example.com      |           |
      |   token: <reader-token>                |           |
      |   policies:                            |           |
      |     - policy: <reader-policy>          |           |
    Then these requests get these responses:
      | request                                 | response                              |
      | as: <reader-token>                      | code: 403                             |+
      | method: GET                             | body:                                 |
      | path: /items/test_singular_permissions  |   errors:                             |
      | query:                                  |     - message: >-                     |
      |   fields: name                          |         You don't have permission to  |
      |   filter[name][_eq]: <run>              |         access collection             |
      |                                         |         "test_singular_permissions"   |
      |                                         |         or it does not exist. Queried |
      |                                         |         in root.                      |
      | method: POST                            | code: 200                             |+
      | path: /permissions                      | body:                                 |
      | payload:                                |   data:                               |
      |   policy: <reader-policy>               |     action: read                      |
      |   collection: test_singular_permissions |                                       |
      |   action: read                          |                                       |
      |   fields:                               |                                       |
      |     - '*'                               |                                       |
      | remember: grant                         |                                       |
      | as: <reader-token>                      | code: 200                             |+
      | method: GET                             | body:                                 |
      | path: /items/test_singular_permissions  |   data:                               |
      | query:                                  |     - name: <run>                     |
      |   fields: name                          |                                       |
      |   filter[name][_eq]: <run>              |                                       |
      | method: PATCH                           | code: 200                             |+
      | path: /permissions/<grant>              |                                       |
      | payload:                                |                                       |
      |   permissions:                          |                                       |
      |     name:                               |                                       |
      |       _eq: other-<run>                  |                                       |
      | as: <reader-token>                      | code: 200                             |+
      | method: GET                             | body:                                 |
      | path: /items/test_singular_permissions  |   data: []                            |
      | query:                                  |                                       |
      |   fields: name                          |                                       |
      |   filter[name][_eq]: <run>              |                                       |
      | method: DELETE                          | code: 204                             |+
      | path: /permissions/<grant>              |                                       |
      | as: <reader-token>                      | code: 403                             |+
      | method: GET                             | body:                                 |
      | path: /items/test_singular_permissions  |   errors:                             |
      | query:                                  |     - message: >-                     |
      |   fields: name                          |         You don't have permission to  |
      |   filter[name][_eq]: <run>              |         access collection             |
      |                                         |         "test_singular_permissions"   |
      |                                         |         or it does not exist. Queried |
      |                                         |         in root.                      |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 2       | directus_access      | 2      | 0      | 0      | 0      |
      | 2       | directus_activity    | 0      | 1      | 0      | 0      |
      | 2       | directus_permissions | 1      | 1      | 0      | 0      |
      | 2       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 2       | directus_roles       | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | directus_access      | 2      | 0      | 0      | 0      |
      | 4       | directus_activity    | 0      | 1      | 0      | 0      |
      | 4       | directus_permissions | 2      | 0      | 1      | 0      |
      | 4       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 4       | directus_roles       | 1      | 0      | 0      | 0      |
      | 4       | directus_users       | 1      | 0      | 0      | 0      |
      | 6       | directus_access      | 2      | 0      | 0      | 0      |
      | 6       | directus_activity    | 0      | 1      | 0      | 0      |
      | 6       | directus_permissions | 0      | 0      | 0      | 1      |
      | 6       | directus_roles       | 1      | 0      | 0      | 0      |
      | 6       | directus_users       | 1      | 0      | 0      | 0      |

  Scenario: a permission matched by a query takes the update
    Given these requests are sent:
      | request                                     | response  |
      | method: POST                                | code: 200 |+
      | path: /policies                             |           |
      | payload:                                    |           |
      |   id: <queried-policy>                      |           |
      |   name: queried-<run>                       |           |
      |   app_access: false                         |           |
      |   admin_access: false                       |           |
      |   permissions:                              |           |
      |     - collection: test_singular_permissions |           |
      |       action: read                          |           |
      |       fields:                               |           |
      |         - '*'                               |           |
    Then these requests get these responses:
      | request                                 | response                       |
      | method: PATCH                           | code: 200                      |+
      | path: /permissions                      |                                |
      | query:                                  |                                |
      |   fields: policy,fields                 |                                |
      | payload:                                |                                |
      |   query:                                |                                |
      |     filter:                             |                                |
      |       policy:                           |                                |
      |         _eq: <queried-policy>           |                                |
      |   data:                                 |                                |
      |     fields:                             |                                |
      |       - name                            |                                |
      | method: GET                             | code: 200                      |+
      | path: /permissions                      | body:                          |
      | query:                                  |   data:                        |
      |   fields: policy,fields                 |     - policy: <queried-policy> |
      |   filter[policy][_eq]: <queried-policy> |       fields:                  |
      |                                         |         - name                 |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete | with |
      | 1       | directus_access      | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields      | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions | 3      | 0      | 1      | 0      | 0    |
      | 1       | directus_relations   | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles       | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_users       | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns     | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema   | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint        | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index             | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc              | 1      | 0      | 0      | 0      | 0    |

  Scenario: a permission filter on id leaves out the app minimal permissions
    Given these requests are sent:
      | request                                 | response  |
      | method: POST                            | code: 200 |+
      | path: /policies                         |           |
      | payload:                                |           |
      |   id: <filtered-policy>                 |           |
      |   name: filtered-<run>                  |           |
      |   app_access: false                     |           |
      |   admin_access: false                   |           |
      | method: POST                            | code: 200 |+
      | path: /permissions                      |           |
      | payload:                                |           |
      |   policy: <filtered-policy>             |           |
      |   collection: test_singular_permissions |           |
      |   action: read                          |           |
      | remember: reading                       |           |
      | method: POST                            | code: 200 |+
      | path: /permissions                      |           |
      | payload:                                |           |
      |   policy: <filtered-policy>             |           |
      |   collection: test_singular_permissions |           |
      |   action: create                        |           |
      | remember: creating                      |           |
    Then these requests get these responses:
      | request                                   | response                        |
      | method: GET                               | code: 200                       |+
      | path: /permissions                        | body:                           |
      | query:                                    |   data:                         |
      |   fields: action                          |     - action: create            |
      |   sort: action                            |     - action: read              |
      |   filter[id][_in]: '<reading>,<creating>' |                                 |
      | method: GET                               | code: 404                       |+
      | path: /permissions/2147483000             | body:                           |
      |                                           |   errors:                       |
      |                                           |     - message: >-               |
      |                                           |         Item "2147483000"       |
      |                                           |         doesn't exist in        |
      |                                           |         collection              |
      |                                           |         "directus_permissions". |
