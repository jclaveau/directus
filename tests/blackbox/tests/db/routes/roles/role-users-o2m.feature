Feature: A role's users list moves users in and takes the others out

  - Pins today's single-role contract (#746). `directus_roles.users` is the
    one-to-many side of `directus_users.role`: a user listed on a role moves
    into it, leaving the role it held, and a user no longer listed is taken
    out and keeps no role. A new user listed is created in the role.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: the users list of a role moves users in and takes the others out
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <first-role>                  |           |
      |   name: first-<run>                 |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <second-role>                 |           |
      |   name: second-<run>                |           |
      | method: POST                        | code: 200 |+
      | path: /users                        |           |
      | payload:                            |           |
      |   - id: <first-user>                |           |
      |     email: first-<run>@example.com  |           |
      |     role: <first-role>              |           |
      |   - id: <second-user>               |           |
      |     email: second-<run>@example.com |           |
      |     role: <first-role>              |           |
    Then these requests get these responses:
      | request                              | response                              |
      | method: PATCH                        | code: 200                             |+
      | path: /roles/<second-role>           |                                       |
      | payload:                             |                                       |
      |   users:                             |                                       |
      |     - id: <first-user>               |                                       |
      | method: GET                          | code: 200                             |+
      | path: /users                         | body:                                 |
      | query:                               |   data:                               |
      |   fields: email,status,role          |     - email: first-<run>@example.com  |
      |   sort: email                        |       status: active                  |
      |   filter[email][_contains]: <run>    |       role: <second-role>             |
      |                                      |     - email: second-<run>@example.com |
      |                                      |       status: active                  |
      |                                      |       role: <first-role>              |
      | method: PATCH                        | code: 200                             |+
      | path: /roles/<second-role>           |                                       |
      | payload:                             |                                       |
      |   users:                             |                                       |
      |     - id: <second-user>              |                                       |
      |     - email: third-<run>@example.com |                                       |
      | method: GET                          | code: 200                             |+
      | path: /users                         | body:                                 |
      | query:                               |   data:                               |
      |   fields: email,status,role          |     - email: first-<run>@example.com  |
      |   sort: email                        |       status: active                  |
      |   filter[email][_contains]: <run>    |       role: null                      |
      |                                      |     - email: second-<run>@example.com |
      |                                      |       status: active                  |
      |                                      |       role: <second-role>             |
      |                                      |     - email: third-<run>@example.com  |
      |                                      |       status: active                  |
      |                                      |       role: <second-role>             |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete | with |
      | 1       | directus_access      | 4      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity    | 0      | 2      | 0      | 0      | 0    |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles       | 6      | 0      | 0      | 0      | 0    |
      | 1       | directus_users       | 8      | 0      | 1      | 0      | 0    |
      | 2       | directus_access      | 2      | 0      | 0      | 0      | 0    |
      | 2       | directus_collections | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_fields      | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_relations   | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_roles       | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_users       | 2      | 0      | 0      | 0      | 0    |
      | 2       | geometry_columns     | 0      | 0      | 0      | 0      | 1    |
      | 2       | information_schema   | 1      | 0      | 0      | 0      | 0    |
      | 2       | pg_constraint        | 1      | 0      | 0      | 0      | 0    |
      | 2       | pg_index             | 2      | 0      | 0      | 0      | 0    |
      | 2       | pg_proc              | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_access      | 5      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity    | 0      | 4      | 0      | 0      | 0    |
      | 3       | directus_revisions   | 0      | 3      | 0      | 0      | 0    |
      | 3       | directus_roles       | 6      | 0      | 0      | 0      | 0    |
      | 3       | directus_users       | 10     | 1      | 2      | 0      | 0    |
      | 4       | directus_access      | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_collections | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_fields      | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_relations   | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_roles       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_users       | 2      | 0      | 0      | 0      | 0    |
      | 4       | geometry_columns     | 0      | 0      | 0      | 0      | 1    |
      | 4       | information_schema   | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_constraint        | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_index             | 2      | 0      | 0      | 0      | 0    |
      | 4       | pg_proc              | 1      | 0      | 0      | 0      | 0    |
