Feature: A setting naming the user's one role is stored as written

  - Pins today's single-role contract (#746). `$CURRENT_ROLE` is accepted in
    a preset's filter, created or updated, a field's validation, a panel's
    options and an operation's options, and stored as written; a field takes
    the `role-updated` special.
  - A Given states the database rows a scenario starts from, written straight
    into the database; the feature's collection is created before it runs.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.
  - A field's creation states no statements: it runs `show`, `with` and
    `alter` on the Postgres catalogs, a table wider than the 90 columns a
    feature line takes.

  Scenario: a preset, a panel and an operation take $CURRENT_ROLE
    Given the rows of directus_dashboards:
      | id          | name          |
      | <dashboard> | payload-<run> |
    And the rows of directus_flows:
      | id     | name          | status   | trigger |
      | <flow> | payload-<run> | inactive | manual  |
    Then these requests get these responses:
      | request                                | response                      |
      | method: POST                           | code: 200                     |+
      | path: /presets                         |                               |
      | remember: preset                       |                               |
      | payload:                               |                               |
      |   bookmark: payload-<run>              |                               |
      |   collection: directus_users           |                               |
      |   filter:                              |                               |
      |     role:                              |                               |
      |       _eq: $CURRENT_ROLE               |                               |
      | method: POST                           | code: 200                     |+
      | path: /panels                          |                               |
      | payload:                               |                               |
      |   dashboard: <dashboard>               |                               |
      |   type: metric                         |                               |
      |   position_x: 1                        |                               |
      |   position_y: 1                        |                               |
      |   width: 4                             |                               |
      |   height: 4                            |                               |
      |   options:                             |                               |
      |     filter:                            |                               |
      |       role:                            |                               |
      |         _eq: $CURRENT_ROLE             |                               |
      | method: POST                           | code: 200                     |+
      | path: /operations                      |                               |
      | payload:                               |                               |
      |   flow: <flow>                         |                               |
      |   key: log_role                        |                               |
      |   type: log                            |                               |
      |   position_x: 19                       |                               |
      |   position_y: 1                        |                               |
      |   options:                             |                               |
      |     message: $CURRENT_ROLE             |                               |
      | method: PATCH                          | code: 200                     |+
      | path: /presets/<preset>                |                               |
      | payload:                               |                               |
      |   filter:                              |                               |
      |     role:                              |                               |
      |       _neq: $CURRENT_ROLE              |                               |
      | method: GET                            | code: 200                     |+
      | path: /presets                         | body:                         |
      | query:                                 |   data:                       |
      |   fields: filter                       |     - filter:                 |
      |   filter[bookmark][_eq]: payload-<run> |         role:                 |
      |                                        |           _neq: $CURRENT_ROLE |
    And on postgres the requests ran these statements:
      | request | table               | select | insert | update | delete |
      | 1       | directus_presets    | 1      | 1      | 0      | 0      |
      | 1       | directus_users      | 1      | 0      | 0      | 0      |
      | 2       | directus_activity   | 0      | 1      | 0      | 0      |
      | 2       | directus_panels     | 1      | 1      | 0      | 0      |
      | 2       | directus_revisions  | 0      | 1      | 0      | 0      |
      | 2       | directus_users      | 1      | 0      | 0      | 0      |
      | 3       | directus_activity   | 0      | 1      | 0      | 0      |
      | 3       | directus_flows      | 1      | 0      | 0      | 0      |
      | 3       | directus_operations | 1      | 1      | 0      | 0      |
      | 3       | directus_revisions  | 0      | 1      | 0      | 0      |
      | 3       | directus_users      | 1      | 0      | 0      | 0      |
      | 4       | directus_presets    | 1      | 0      | 1      | 0      |
      | 4       | directus_users      | 1      | 0      | 0      | 0      |
      | 5       | directus_presets    | 1      | 0      | 0      | 0      |
      | 5       | directus_users      | 1      | 0      | 0      | 0      |

  Scenario: a field takes $CURRENT_ROLE in its validation and the role-updated special
    Then these requests get these responses:
      | request                                   | response                      |
      | method: POST                              | code: 200                     |+
      | path: /fields/role_var_notes              |                               |
      | payload:                                  |                               |
      |   field: role_tag                         |                               |
      |   type: string                            |                               |
      |   meta:                                   |                               |
      |     validation:                           |                               |
      |       role_tag:                           |                               |
      |         _eq: $CURRENT_ROLE                |                               |
      | method: POST                              | code: 200                     |+
      | path: /fields/role_var_notes              |                               |
      | payload:                                  |                               |
      |   field: updated_role                     |                               |
      |   type: uuid                              |                               |
      |   meta:                                   |                               |
      |     special: [role-updated]               |                               |
      | method: GET                               | code: 200                     |+
      | path: /fields/role_var_notes/role_tag     | body:                         |
      |                                           |   data:                       |
      |                                           |     meta:                     |
      |                                           |       validation:             |
      |                                           |         role_tag:             |
      |                                           |           _eq: $CURRENT_ROLE  |
      | method: GET                               | code: 200                     |+
      | path: /fields/role_var_notes/updated_role | body:                         |
      |                                           |   data:                       |
      |                                           |     meta:                     |
      |                                           |       special: [role-updated] |
