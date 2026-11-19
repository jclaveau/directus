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
      | request | table                | select | insert | update | delete | with |
      | 1       | directus_access      | 7      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity    | 0      | 3      | 0      | 0      | 0    |
      | 1       | directus_presets     | 1      | 0      | 0      | 1      | 0    |
      | 1       | directus_revisions   | 0      | 2      | 0      | 0      | 0    |
      | 1       | directus_roles       | 7      | 0      | 1      | 1      | 0    |
      | 1       | directus_sessions    | 0      | 0      | 0      | 1      | 0    |
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
      | 3       | directus_users       | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_roles       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_users       | 1      | 0      | 0      | 0      | 0    |
      | 5       | directus_presets     | 1      | 0      | 0      | 0      | 0    |
      | 5       | directus_users       | 1      | 0      | 0      | 0      | 0    |
