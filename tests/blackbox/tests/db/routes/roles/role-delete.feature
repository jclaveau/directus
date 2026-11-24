Feature: A role a user belongs to stays, a deleted one drops its presets

  - A role a user belongs to is never deleted (#763): its users would be left
    with nothing to do. A deleted role takes its presets, and the roles under
    it are left with no parent.
  - A Given states the database rows a scenario starts from, written straight
    into the database.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: a role a user belongs to is not deleted
    Given the rows of directus_roles:
      | id          | name       |
      | <held-role> | held-<run> |
    And the rows of directus_users:
      | id       | email                    | role        |
      | <member> | member-<run>@example.com | <held-role> |
    Then these requests get these responses:
      | request                  | response                           |
      | method: DELETE           | code: 400                          |+
      | path: /roles/<held-role> | body:                              |
      |                          |   errors:                          |
      |                          |     - message: >-                  |
      |                          |         Invalid payload. Role      |
      |                          |         "<held-role>" can't be     |
      |                          |         deleted while users belong |
      |                          |         to it.                     |
      | method: GET              | code: 200                          |+
      | path: /users/<member>    | body:                              |
      | query:                   |   data:                            |
      |   fields: status,role    |     status: active                 |
      |                          |     role: <held-role>              |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 0      | 0      | 0      | 0      |

  Scenario: a deleted role drops its preset, frees its child
    Given the rows of directus_roles:
      | id             | name          | parent         |
      | <deleted-role> | deleted-<run> | null           |
      | <child-role>   | child-<run>   | <deleted-role> |
    And the rows of directus_users:
      | id             | email                          | role         |
      | <child-member> | child-member-<run>@example.com | <child-role> |
    And the rows of directus_presets:
      | bookmark      | collection     | role           |
      | deleted-<run> | directus_users | <deleted-role> |
    Then these requests get these responses:
      | request                                | response               |
      | method: DELETE                         | code: 204              |+
      | path: /roles/<deleted-role>            |                        |
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
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 0      | 0      | 0      | 0      |
