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
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 2       | directus_access    | 1      | 1      | 0      | 0      |
      | 2       | directus_activity  | 0      | 1      | 0      | 0      |
      | 2       | directus_revisions | 0      | 1      | 0      | 0      |
      | 2       | directus_users     | 1      | 0      | 0      | 0      |
      | 4       | directus_access    | 6      | 0      | 1      | 0      |
      | 4       | directus_activity  | 0      | 1      | 0      | 0      |
      | 4       | directus_revisions | 0      | 1      | 0      | 0      |
      | 4       | directus_roles     | 2      | 0      | 0      | 0      |
      | 4       | directus_users     | 2      | 0      | 0      | 0      |
      | 6       | directus_access    | 6      | 0      | 1      | 0      |
      | 6       | directus_activity  | 0      | 1      | 0      | 0      |
      | 6       | directus_revisions | 0      | 1      | 0      | 0      |
      | 6       | directus_roles     | 2      | 0      | 0      | 0      |
      | 6       | directus_users     | 2      | 0      | 0      | 0      |
      | 8       | directus_access    | 4      | 0      | 0      | 1      |
      | 8       | directus_activity  | 0      | 1      | 0      | 0      |
      | 8       | directus_roles     | 2      | 0      | 0      | 0      |
      | 8       | directus_users     | 2      | 0      | 0      | 0      |

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
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 5      | 0      | 1      | 0      |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      |
      | 1       | directus_collections | 1      | 0      | 0      | 0      |
      | 1       | directus_fields      | 1      | 0      | 0      | 0      |
      | 1       | directus_relations   | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 1       | directus_roles       | 2      | 0      | 0      | 0      |
      | 1       | directus_users       | 2      | 0      | 0      | 0      |
      | 1       | geometry_columns     | 0      | 0      | 0      | 0      |
      | 1       | information_schema   | 1      | 0      | 0      | 0      |
      | 1       | pg_constraint        | 1      | 0      | 0      | 0      |
      | 1       | pg_index             | 1      | 0      | 0      | 0      |
      | 1       | pg_proc              | 1      | 0      | 0      | 0      |
      | 2       | directus_access      | 6      | 0      | 1      | 0      |
      | 2       | directus_activity    | 0      | 1      | 0      | 0      |
      | 2       | directus_collections | 1      | 0      | 0      | 0      |
      | 2       | directus_fields      | 1      | 0      | 0      | 0      |
      | 2       | directus_relations   | 1      | 0      | 0      | 0      |
      | 2       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 2       | directus_roles       | 2      | 0      | 0      | 0      |
      | 2       | directus_users       | 2      | 0      | 0      | 0      |
      | 2       | geometry_columns     | 0      | 0      | 0      | 0      |
      | 2       | information_schema   | 1      | 0      | 0      | 0      |
      | 2       | pg_constraint        | 1      | 0      | 0      | 0      |
      | 2       | pg_index             | 1      | 0      | 0      | 0      |
      | 2       | pg_proc              | 1      | 0      | 0      | 0      |

  Scenario: a key no item holds is not found for the admin, forbidden to a user
    Given these requests are sent:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <writer-policy>                  |           |
      |   name: writer-<run>                   |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      |   permissions:                         |           |
      |     - collection: test_singular_access |           |
      |       action: read                     |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      |     - collection: test_singular_access |           |
      |       action: update                   |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      |     - collection: test_singular_access |           |
      |       action: delete                   |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   email: writer-<run>@example.com      |           |
      |   token: <writer-token>                |           |
      |   policies:                            |           |
      |     - policy: <writer-policy>          |           |
    Then these requests get these responses:
      | request                                      | response                        |
      | method: GET                                  | code: 404                       |+
      | path: /items/test_singular_access/2147483000 | body:                           |
      |                                              |   errors:                       |
      |                                              |     - message: >-               |
      |                                              |         Item "2147483000"       |
      |                                              |         doesn't exist in        |
      |                                              |         collection              |
      |                                              |         "test_singular_access". |
      | method: PATCH                                | code: 404                       |+
      | path: /items/test_singular_access/2147483000 | body:                           |
      | payload:                                     |   errors:                       |
      |   name: patched                              |     - message: >-               |
      |                                              |         Item "2147483000"       |
      |                                              |         doesn't exist in        |
      |                                              |         collection              |
      |                                              |         "test_singular_access". |
      | method: DELETE                               | code: 404                       |+
      | path: /items/test_singular_access/2147483000 | body:                           |
      |                                              |   errors:                       |
      |                                              |     - message: >-               |
      |                                              |         Item "2147483000"       |
      |                                              |         doesn't exist in        |
      |                                              |         collection              |
      |                                              |         "test_singular_access". |
      | as: <writer-token>                           | code: 403                       |+
      | method: GET                                  | body:                           |
      | path: /items/test_singular_access/2147483000 |   errors:                       |
      |                                              |     - message: >-               |
      |                                              |         No result found for key |
      |                                              |         2147483000 in           |
      |                                              |         test_singular_access    |
      |                                              |         during items.readOne()  |
      | as: <writer-token>                           | code: 403                       |+
      | method: PATCH                                | body:                           |
      | path: /items/test_singular_access/2147483000 |   errors:                       |
      | payload:                                     |     - message: >-               |
      |   name: patched                              |         You don't have          |
      |                                              |         permissions to perform  |
      |                                              |         "update" for the        |
      |                                              |         field(s) "name" in      |
      |                                              |         collection              |
      |                                              |         "test_singular_access"  |
      |                                              |         or it does not exist.   |
      | as: <writer-token>                           | code: 403                       |+
      | method: DELETE                               | body:                           |
      | path: /items/test_singular_access/2147483000 |   errors:                       |
      |                                              |     - message: >-               |
      |                                              |         You don't have          |
      |                                              |         permission to perform   |
      |                                              |         "delete" for collection |
      |                                              |         "test_singular_access"  |
      |                                              |         or it does not exist.   |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | test_singular_access | 1      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |
      | 3       | test_singular_access | 1      | 0      | 0      | 0      |
      | 5       | directus_permissions | 2      | 0      | 0      | 0      |
      | 5       | directus_users       | 1      | 0      | 0      | 0      |
      | 5       | test_singular_access | 1      | 0      | 0      | 0      |
      | 6       | directus_permissions | 2      | 0      | 0      | 0      |
      | 6       | directus_users       | 1      | 0      | 0      | 0      |
      | 6       | test_singular_access | 1      | 0      | 0      | 0      |

  Scenario: a key a batch delete misses is not found for the admin, forbidden to a user
    Given these requests are sent:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <deleter-policy>                 |           |
      |   name: deleter-<run>                  |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      |   permissions:                         |           |
      |     - collection: test_singular_access |           |
      |       action: delete                   |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   email: deleter-<run>@example.com     |           |
      |   token: <deleter-token>               |           |
      |   policies:                            |           |
      |     - policy: <deleter-policy>         |           |
      | method: POST                           | code: 200 |+
      | path: /items/test_singular_access      |           |
      | payload:                               |           |
      |   name: kept-<run>                     |           |
      | remember: kept                         |           |
    Then these requests get these responses:
      | request                                  | response                        |
      | method: DELETE                           | code: 404                       |+
      | path: /items/test_singular_access        | body:                           |
      | payload:                                 |   errors:                       |
      |   - 2147483000                           |     - message: >-               |
      |                                          |         Item "2147483000"       |
      |                                          |         doesn't exist in        |
      |                                          |         collection              |
      |                                          |         "test_singular_access". |
      | method: DELETE                           | code: 404                       |+
      | path: /items/test_singular_access        | body:                           |
      | payload:                                 |   errors:                       |
      |   - <kept>                               |     - message: >-               |
      |   - 2147483000                           |         Item "2147483000"       |
      |                                          |         doesn't exist in        |
      |                                          |         collection              |
      |                                          |         "test_singular_access". |
      | method: GET                              | code: 200                       |+
      | path: /items/test_singular_access/<kept> | body:                           |
      | query:                                   |   data:                         |
      |   fields: name                           |     name: kept-<run>            |
      | as: <deleter-token>                      | code: 403                       |+
      | method: DELETE                           | body:                           |
      | path: /items/test_singular_access        |   errors:                       |
      | payload:                                 |     - message: >-               |
      |   - 2147483000                           |         You don't have          |
      |                                          |         permission to perform   |
      |                                          |         "delete" for collection |
      |                                          |         "test_singular_access"  |
      |                                          |         or it does not exist.   |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 1       | test_singular_access | 2      | 0      | 0      | 1      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | test_singular_access | 2      | 0      | 0      | 1      |
      | 4       | directus_access      | 3      | 0      | 0      | 0      |
      | 4       | directus_permissions | 3      | 0      | 0      | 0      |
      | 4       | directus_policies    | 1      | 0      | 0      | 0      |
      | 4       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | test_singular_access | 1      | 0      | 0      | 0      |
