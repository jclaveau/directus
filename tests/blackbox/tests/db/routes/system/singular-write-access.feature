Feature: A single access row grants its policy from the next request on

  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: an access row created, moved and deleted reaches its user at once
    Given these requests are sent:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <reader-policy>                  |           |
      |   name: reader-<run>                   |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      |   permissions:                         |           |
      |     - collection: test_singular_access |           |
      |       action: read                     |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <empty-policy>                   |           |
      |   name: empty-<run>                    |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   id: <reader>                         |           |
      |   email: reader-<run>@example.com      |           |
      |   token: <reader-token>                |           |
    Then these requests get these responses:
      | request                           | response                                 |
      | as: <reader-token>                | code: 403                                |+
      | method: GET                       | body:                                    |
      | path: /items/test_singular_access |   errors:                                |
      | query:                            |     - message: >-                        |
      |   fields: id                      |         You don't have permission to     |
      |                                   |         access collection                |
      |                                   |         "test_singular_access" or it     |
      |                                   |         does not exist. Queried in root. |
      | method: POST                      | code: 200                                |+
      | path: /access                     | body:                                    |
      | payload:                          |   data:                                  |
      |   id: <grant>                     |     policy: <reader-policy>              |
      |   policy: <reader-policy>         |     user: <reader>                       |
      |   user: <reader>                  |                                          |
      | as: <reader-token>                | code: 200                                |+
      | method: GET                       | body:                                    |
      | path: /items/test_singular_access |   data: []                               |
      | query:                            |                                          |
      |   fields: id                      |                                          |
      | method: PATCH                     | code: 200                                |+
      | path: /access/<grant>             | body:                                    |
      | payload:                          |   data:                                  |
      |   policy: <empty-policy>          |     policy: <empty-policy>               |
      | as: <reader-token>                | code: 403                                |+
      | method: GET                       | body:                                    |
      | path: /items/test_singular_access |   errors:                                |
      | query:                            |     - message: >-                        |
      |   fields: id                      |         You don't have permission to     |
      |                                   |         access collection                |
      |                                   |         "test_singular_access" or it     |
      |                                   |         does not exist. Queried in root. |
      | method: PATCH                     | code: 200                                |+
      | path: /access/<grant>             | body:                                    |
      | payload:                          |   data:                                  |
      |   policy: <reader-policy>         |     policy: <reader-policy>              |
      | as: <reader-token>                | code: 200                                |+
      | method: GET                       | body:                                    |
      | path: /items/test_singular_access |   data: []                               |
      | query:                            |                                          |
      |   fields: id                      |                                          |
      | method: DELETE                    | code: 204                                |+
      | path: /access/<grant>             |                                          |
      | as: <reader-token>                | code: 403                                |+
      | method: GET                       | body:                                    |
      | path: /items/test_singular_access |   errors:                                |
      | query:                            |     - message: >-                        |
      |   fields: id                      |         You don't have permission to     |
      |                                   |         access collection                |
      |                                   |         "test_singular_access" or it     |
      |                                   |         does not exist. Queried in root. |

  Scenario: an access row is moved in batches and by a query
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /policies                   |           |
      | payload:                          |           |
      |   id: <first-policy>              |           |
      |   name: first-<run>               |           |
      |   app_access: false               |           |
      |   admin_access: false             |           |
      | method: POST                      | code: 200 |+
      | path: /policies                   |           |
      | payload:                          |           |
      |   id: <second-policy>             |           |
      |   name: second-<run>              |           |
      |   app_access: false               |           |
      |   admin_access: false             |           |
      | method: POST                      | code: 200 |+
      | path: /users                      |           |
      | payload:                          |           |
      |   id: <holder>                    |           |
      |   email: holder-<run>@example.com |           |
      | method: POST                      | code: 200 |+
      | path: /access                     |           |
      | payload:                          |           |
      |   id: <grant>                     |           |
      |   policy: <first-policy>          |           |
      |   user: <holder>                  |           |
    Then these requests get these responses:
      | request                     | response                      |
      | method: PATCH               | code: 200                     |+
      | path: /access               | body:                         |
      | query:                      |   data:                       |
      |   fields: id,policy         |     - id: <grant>             |
      | payload:                    |       policy: <second-policy> |
      |   - id: <grant>             |                               |
      |     policy: <second-policy> |                               |
      | method: PATCH               | code: 200                     |+
      | path: /access               | body:                         |
      | query:                      |   data:                       |
      |   fields: id,policy         |     - id: <grant>             |
      | payload:                    |       policy: <first-policy>  |
      |   query:                    |                               |
      |     filter:                 |                               |
      |       user:                 |                               |
      |         _eq: <holder>       |                               |
      |   data:                     |                               |
      |     policy: <first-policy>  |                               |
