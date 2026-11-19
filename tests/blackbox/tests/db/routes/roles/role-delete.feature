Feature: A deleted role suspends its users and drops its presets

  - Pins today's single-role contract (#746). Deleting a role suspends every
    user holding it and empties their role, deletes the presets of the role,
    and leaves the roles under it with no parent.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: a deleted role suspends its user, drops its preset, frees its child
    Given these requests are sent:
      | request                                 | response  |
      | method: POST                            | code: 200 |+
      | path: /roles                            |           |
      | payload:                                |           |
      |   id: <deleted-role>                    |           |
      |   name: deleted-<run>                   |           |
      | method: POST                            | code: 200 |+
      | path: /roles                            |           |
      | payload:                                |           |
      |   id: <child-role>                      |           |
      |   name: child-<run>                     |           |
      |   parent: <deleted-role>                |           |
      | method: POST                            | code: 200 |+
      | path: /users                            |           |
      | payload:                                |           |
      |   id: <member>                          |           |
      |   email: member-<run>@example.com       |           |
      |   role: <deleted-role>                  |           |
      | method: POST                            | code: 200 |+
      | path: /users                            |           |
      | payload:                                |           |
      |   id: <child-member>                    |           |
      |   email: child-member-<run>@example.com |           |
      |   role: <child-role>                    |           |
      | method: POST                            | code: 200 |+
      | path: /presets                          |           |
      | payload:                                |           |
      |   bookmark: deleted-<run>               |           |
      |   collection: directus_users            |           |
      |   role: <deleted-role>                  |           |
    Then these requests get these responses:
      | request                                | response               |
      | method: DELETE                         | code: 204              |+
      | path: /roles/<deleted-role>            |                        |
      | method: GET                            | code: 200              |+
      | path: /users/<member>                  | body:                  |
      | query:                                 |   data:                |
      |   fields: status,role                  |     status: suspended  |
      |                                        |     role: null         |
      | method: GET                            | code: 200              |+
      | path: /users/<child-member>            | body:                  |
      | query:                                 |   data:                |
      |   fields: status,role                  |     status: active     |
      |                                        |     role: <child-role> |
      | method: GET                            | code: 200              |+
      | path: /roles/<child-role>              | body:                  |
      | query:                                 |   data:                |
      |   fields: parent                       |     parent: null       |
      | method: GET                            | code: 200              |+
      | path: /presets                         | body:                  |
      | query:                                 |   data: []             |
      |   fields: id                           |                        |
      |   filter[bookmark][_eq]: deleted-<run> |                        |
    And on postgres the requests ran these statements:
      | request | table  | select | insert | update | delete |
      | 1       | (none) | 0      | 0      | 0      | 0      |
      | 2       | (none) | 0      | 0      | 0      | 0      |
      | 3       | (none) | 0      | 0      | 0      | 0      |
      | 4       | (none) | 0      | 0      | 0      | 0      |
      | 5       | (none) | 0      | 0      | 0      | 0      |
