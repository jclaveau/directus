Feature: A deleted permission refuses the next read at once

  - Deleting a permission clears the permissions cache: the next read of the
    reader it applied to is refused, not answered from the cached permissions
    (#751).
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a reader is refused as soon as their permission is deleted
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /collections                |           |
      | payload:                          |           |
      |   collection: clear_notes         |           |
      |   schema: {}                      |           |
      |   meta: {}                        |           |
      |   fields:                         |           |
      |     - field: label                |           |
      |       type: string                |           |
      |       meta: {}                    |           |
      | method: POST                      | code: 200 |+
      | path: /items/clear_notes          |           |
      | payload:                          |           |
      |   label: before the change        |           |
      | method: POST                      | code: 200 |+
      | path: /policies                   |           |
      | payload:                          |           |
      |   id: <reader-policy>             |           |
      |   name: reader-<run>              |           |
      |   app_access: false               |           |
      |   admin_access: false             |           |
      | method: POST                      | code: 200 |+
      | path: /permissions                |           |
      | payload:                          |           |
      |   policy: <reader-policy>         |           |
      |   collection: clear_notes         |           |
      |   action: read                    |           |
      |   fields: ['*']                   |           |
      | remember: grant                   |           |
      | method: POST                      | code: 200 |+
      | path: /roles                      |           |
      | payload:                          |           |
      |   id: <reader-role>               |           |
      |   name: reader-<run>              |           |
      |   policies:                       |           |
      |     - policy: <reader-policy>     |           |
      | method: POST                      | code: 200 |+
      | path: /users                      |           |
      | payload:                          |           |
      |   email: reader-<run>@example.com |           |
      |   role: <reader-role>             |           |
      |   token: reader-<run>             |           |
    Then these requests get these responses:
      | request                    | response                                    |
      | as: reader-<run>           | code: 200                                   |+
      | method: GET                | body:                                       |
      | path: /items/clear_notes   |   data:                                     |
      | query:                     |     - label: before the change              |
      |   fields: label            |                                             |
      | method: DELETE             | code: 204                                   |+
      | path: /permissions/<grant> |                                             |
      | as: reader-<run>           | code: 403                                   |+
      | method: GET                | body:                                       |
      | path: /items/clear_notes   |   errors:                                   |
      | query:                     |     - message: >-                           |
      |   fields: label            |         You don't have permission to access |
      |                            |         collection "clear_notes" or it does |
      |                            |         not exist. Queried in root.         |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete | with |
      | 1       | clear_notes          | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_access      | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_roles       | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_users       | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_activity    | 0      | 1      | 0      | 0      | 0    |
      | 2       | directus_permissions | 0      | 0      | 0      | 1      | 0    |
      | 2       | directus_users       | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_access      | 3      | 0      | 0      | 0      | 0    |
      | 3       | directus_collections | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_fields      | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_permissions | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_policies    | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_relations   | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_roles       | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_users       | 1      | 0      | 0      | 0      | 0    |
      | 3       | geometry_columns     | 0      | 0      | 0      | 0      | 1    |
      | 3       | information_schema   | 1      | 0      | 0      | 0      | 0    |
      | 3       | pg_constraint        | 1      | 0      | 0      | 0      | 0    |
      | 3       | pg_index             | 2      | 0      | 0      | 0      | 0    |
      | 3       | pg_proc              | 1      | 0      | 0      | 0      | 0    |
