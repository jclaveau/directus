Feature: A role users hold is refused its delete; an empty one drops its presets

  - Deleting a role a user holds is refused, whoever asks: taking it away is
    the delete of its memberships. An empty role's delete drops its access
    rows and presets, and leaves the roles under it with no parent.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: a role a user holds is refused its delete
    Given the rows of directus_roles:
      | id          | name       |
      | <held-role> | held-<run> |
    And the rows of directus_users:
      | id       | email                    |
      | <member> | member-<run>@example.com |
    And the rows of directus_role_members:
      | id         | user     | role        | sort |
      | <member-1> | <member> | <held-role> | 1    |
    Then these requests get these responses:
      | request                     | response                                    |
      | method: DELETE              | code: 400                                   |+
      | path: /roles/<held-role>    | body:                                       |
      |                             |   errors:                                   |
      |                             |     - message: >-                           |
      |                             |         Invalid payload. Role "<held-role>" |
      |                             |         is held by users: delete their      |
      |                             |         memberships of it first.            |
      | method: GET                 | code: 200                                   |+
      | path: /users/<member>       | body:                                       |
      | query:                      |   data:                                     |
      |   fields: status,roles.role |     status: active                          |
      |                             |     roles:                                  |
      |                             |       - role: <held-role>                   |

  Scenario: an empty role's delete drops its access and preset, frees its child
    Given the rows of directus_policies:
      | id         | name         | app_access | admin_access |
      | <p-reader> | reader-<run> | true       | false        |
    And the rows of directus_roles:
      | id             | name          | parent         |
      | <deleted-role> | deleted-<run> | null           |
      | <child-role>   | child-<run>   | <deleted-role> |
    And the rows of directus_access:
      | id       | role           | policy     |
      | <access> | <deleted-role> | <p-reader> |
    And the rows of directus_presets:
      | bookmark      | collection     | role           |
      | deleted-<run> | directus_users | <deleted-role> |
    Then these requests get these responses:
      | request                                | response                   |
      | method: DELETE                         | code: 204                  |+
      | path: /roles/<deleted-role>            |                            |
      | method: GET                            | code: 200                  |+
      | path: /roles/<child-role>              | body:                      |
      | query:                                 |   data:                    |
      |   fields: parent                       |     parent: null           |
      | method: GET                            | code: 200                  |+
      | path: /presets                         | body:                      |
      | query:                                 |   data: []                 |
      |   fields: id                           |                            |
      |   filter[bookmark][_eq]: deleted-<run> |                            |
      | method: GET                            | code: 200                  |+
      | path: /access                          | body:                      |
      | query:                                 |   data: []                 |
      |   fields: id                           |                            |
      |   filter[policy][_eq]: <p-reader>      |                            |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 5      | 0      | 0      | 1      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_presets      | 1      | 0      | 0      | 1      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 5      | 0      | 1      | 1      |
      | 1       | directus_users        | 5      | 0      | 0      | 0      |
