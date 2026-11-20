Feature: A setting naming the user's one role is stored as written

  - Pins today's single-role contract (#746). `$CURRENT_ROLE` is accepted in
    a preset's filter, a field's validation, a panel's options and an
    operation's options, and stored as written; a field takes the
    `role-updated` special.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: a preset, a field, a panel and an operation take $CURRENT_ROLE
    Given these requests are sent:
      | request                                   | response  |
      | method: POST                              | code: 200 |+
      | path: /collections                        |           |
      | payload:                                  |           |
      |   collection: role_variable_payload_notes |           |
      |   schema: {}                              |           |
      |   meta: {}                                |           |
      |   fields:                                 |           |
      |     - field: label                        |           |
      |       type: string                        |           |
      |       meta: {}                            |           |
      | method: POST                              | code: 200 |+
      | path: /dashboards                         |           |
      | payload:                                  |           |
      |   id: <dashboard>                         |           |
      |   name: payload-<run>                     |           |
      | method: POST                              | code: 200 |+
      | path: /flows                              |           |
      | payload:                                  |           |
      |   id: <flow>                              |           |
      |   name: payload-<run>                     |           |
      |   status: inactive                        |           |
      |   trigger: manual                         |           |
    Then these requests get these responses:
      | request                                   | response                     |
      | method: POST                              | code: 200                    |+
      | path: /presets                            |                              |
      | payload:                                  |                              |
      |   bookmark: payload-<run>                 |                              |
      |   collection: directus_users              |                              |
      |   filter:                                 |                              |
      |     role:                                 |                              |
      |       _eq: $CURRENT_ROLE                  |                              |
      | method: POST                              | code: 200                    |+
      | path: /fields/role_variable_payload_notes |                              |
      | payload:                                  |                              |
      |   field: role_tag                         |                              |
      |   type: string                            |                              |
      |   meta:                                   |                              |
      |     validation:                           |                              |
      |       role_tag:                           |                              |
      |         _eq: $CURRENT_ROLE                |                              |
      | method: POST                              | code: 200                    |+
      | path: /fields/role_variable_payload_notes |                              |
      | payload:                                  |                              |
      |   field: updated_role                     |                              |
      |   type: uuid                              |                              |
      |   meta:                                   |                              |
      |     special: [role-updated]               |                              |
      | method: POST                              | code: 200                    |+
      | path: /panels                             |                              |
      | payload:                                  |                              |
      |   dashboard: <dashboard>                  |                              |
      |   type: metric                            |                              |
      |   position_x: 1                           |                              |
      |   position_y: 1                           |                              |
      |   width: 4                                |                              |
      |   height: 4                               |                              |
      |   options:                                |                              |
      |     filter:                               |                              |
      |       role:                               |                              |
      |         _eq: $CURRENT_ROLE                |                              |
      | method: POST                              | code: 200                    |+
      | path: /operations                         |                              |
      | payload:                                  |                              |
      |   flow: <flow>                            |                              |
      |   key: log_role                           |                              |
      |   type: log                               |                              |
      |   position_x: 19                          |                              |
      |   position_y: 1                           |                              |
      |   options:                                |                              |
      |     message: $CURRENT_ROLE                |                              |
      | method: GET                               | code: 200                    |+
      | path: /presets                            | body:                        |
      | query:                                    |   data:                      |
      |   fields: filter                          |     - filter:                |
      |   filter[bookmark][_eq]: payload-<run>    |         role:                |
      |                                           |           _eq: $CURRENT_ROLE |
    And on postgres the requests ran these statements:
      | request | table               | select | insert | update | delete |
      | 1       | directus_presets    | 0      | 0      | 0      | 0      |
      | 2       | directus_fields     | 0      | 0      | 0      | 0      |
      | 3       | directus_fields     | 0      | 0      | 0      | 0      |
      | 4       | directus_panels     | 0      | 0      | 0      | 0      |
      | 5       | directus_operations | 0      | 0      | 0      | 0      |
