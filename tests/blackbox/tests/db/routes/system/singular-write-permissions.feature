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
      | request                       | response                       |
      | method: PATCH                 | code: 200                      |+
      | path: /permissions            | body:                          |
      | query:                        |   data:                        |
      |   fields: policy,fields       |     - policy: <queried-policy> |
      | payload:                      |       fields:                  |
      |   query:                      |         - name                 |
      |     filter:                   |                                |
      |       policy:                 |                                |
      |         _eq: <queried-policy> |                                |
      |   data:                       |                                |
      |     fields:                   |                                |
      |       - name                  |                                |
