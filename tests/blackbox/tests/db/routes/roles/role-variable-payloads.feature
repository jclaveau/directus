Feature: A setting naming the removed $CURRENT_ROLE is refused

  - A user can hold several roles (#746): `$CURRENT_ROLE` is removed, so a
    preset's filter, created or updated, a field's validation, a panel's
    options and an operation's options naming it are refused, and a field
    taking the `role-updated` special is refused.
  - A Given states the database rows a scenario starts from, written straight
    into the database; the feature's collection is created before it runs.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.
  - A field's creation states no statements: it runs `show`, `with` and
    `alter` on the Postgres catalogs, a table wider than the 90 columns a
    feature line takes.

  Scenario: a preset, a panel and an operation naming $CURRENT_ROLE are refused
    Given the rows of directus_dashboards:
      | id          | name          |
      | <dashboard> | payload-<run> |
    And the rows of directus_flows:
      | id     | name          | status   | trigger |
      | <flow> | payload-<run> | inactive | manual  |
    Then these requests get these responses:
      | request                                | response                            |
      | method: POST                           | code: 400                           |+
      | path: /presets                         | body:                               |
      | payload:                               |   errors:                           |
      |   bookmark: refused-<run>              |     - message: >-                   |
      |   collection: directus_users           |         Invalid payload. Field      |
      |   filter:                              |         "filter" uses               |
      |     role:                              |         "$CURRENT_ROLE":            |
      |       _eq: $CURRENT_ROLE               |         "$CURRENT_ROLE" was         |
      |                                        |         removed, a user can hold    |
      |                                        |         several roles: use          |
      |                                        |         "$CURRENT_MEMBER_ROLES"     |
      |                                        |         with "_in" or "_nin".       |
      | method: POST                           | code: 400                           |+
      | path: /panels                          | body:                               |
      | payload:                               |   errors:                           |
      |   dashboard: <dashboard>               |     - message: >-                   |
      |   type: metric                         |         Invalid payload. Field      |
      |   position_x: 1                        |         "options" uses              |
      |   position_y: 1                        |         "$CURRENT_ROLE":            |
      |   width: 4                             |         "$CURRENT_ROLE" was         |
      |   height: 4                            |         removed, a user can hold    |
      |   options:                             |         several roles: use          |
      |     filter:                            |         "$CURRENT_MEMBER_ROLES"     |
      |       role:                            |         with "_in" or "_nin".       |
      |         _eq: $CURRENT_ROLE             |                                     |
      | method: POST                           | code: 400                           |+
      | path: /operations                      | body:                               |
      | payload:                               |   errors:                           |
      |   flow: <flow>                         |     - message: >-                   |
      |   key: log_role                        |         Invalid payload. Field      |
      |   type: log                            |         "options" uses              |
      |   position_x: 19                       |         "$CURRENT_ROLE":            |
      |   position_y: 1                        |         "$CURRENT_ROLE" was         |
      |   options:                             |         removed, a user can hold    |
      |     message: $CURRENT_ROLE             |         several roles: use          |
      |                                        |         "$CURRENT_MEMBER_ROLES"     |
      |                                        |         with "_in" or "_nin".       |
      | method: POST                           | code: 200                           |+
      | path: /presets                         |                                     |
      | remember: preset                       |                                     |
      | payload:                               |                                     |
      |   bookmark: payload-<run>              |                                     |
      |   collection: directus_users           |                                     |
      |   filter:                              |                                     |
      |     status:                            |                                     |
      |       _eq: active                      |                                     |
      | method: PATCH                          | code: 400                           |+
      | path: /presets/<preset>                | body:                               |
      | payload:                               |   errors:                           |
      |   filter:                              |     - message: >-                   |
      |     role:                              |         Invalid payload. Field      |
      |       _neq: $CURRENT_ROLE              |         "filter" uses               |
      |                                        |         "$CURRENT_ROLE":            |
      |                                        |         "$CURRENT_ROLE" was         |
      |                                        |         removed, a user can hold    |
      |                                        |         several roles: use          |
      |                                        |         "$CURRENT_MEMBER_ROLES"     |
      |                                        |         with "_in" or "_nin".       |
      | method: GET                            | code: 200                           |+
      | path: /presets                         | body:                               |
      | query:                                 |   data:                             |
      |   fields: bookmark,filter              |     - bookmark: payload-<run>       |
      |   filter[bookmark][_contains]: <run>   |       filter:                       |
      |                                        |         status:                     |
      |                                        |           _eq: active               |
    And on postgres the requests ran these statements:
      | request | table               | select | insert | update | delete |
      | 1       | directus_users      | 1      | 0      | 0      | 0      |

  Scenario: a field naming $CURRENT_ROLE or taking role-updated is refused
    Then these requests get these responses:
      | request                               | response                             |
      | method: POST                          | code: 400                            |+
      | path: /fields/role_var_notes          | body:                                |
      | payload:                              |   errors:                            |
      |   field: role_tag                     |     - message: >-                    |
      |   type: string                        |         Invalid payload. Field       |
      |   meta:                               |         "validation" uses            |
      |     validation:                       |         "$CURRENT_ROLE":             |
      |       role_tag:                       |         "$CURRENT_ROLE" was removed, |
      |         _eq: $CURRENT_ROLE            |         a user can hold several      |
      |                                       |         roles: use                   |
      |                                       |         "$CURRENT_MEMBER_ROLES" with |
      |                                       |         "_in" or "_nin".             |
      | method: POST                          | code: 400                            |+
      | path: /fields/role_var_notes          | body:                                |
      | payload:                              |   errors:                            |
      |   field: updated_role                 |     - message: >-                    |
      |   type: uuid                          |         Invalid payload. Field       |
      |   meta:                               |         "updated_role" of collection |
      |     special: [role-updated]           |         "role_var_notes" uses the    |
      |                                       |         removed special              |
      |                                       |         "role-updated": a user can   |
      |                                       |         hold several roles, use      |
      |                                       |         "roles-updated" on a json    |
      |                                       |         field.                       |
