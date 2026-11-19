Feature: A user's one role resolves the role variables and orders the presets

  - Pins today's single-role contract (#746). `$CURRENT_ROLE` is the user's
    own role, the leaf of its chain; `$CURRENT_ROLES` is the whole chain. They
    resolve the same in a permission rule, a validation, a preset and a query
    filter. The `role-created` special writes `$CURRENT_ROLE`.
  - Presets are applied policy after policy, parent role first, then the
    user's role, then the policies given to the user directly: on one field
    the last one wins.
  - The app access rule on `directus_presets` shows a user the presets of
    their own role, not those of a parent role.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a preset of the user's role beats the parent's, a direct one both
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /collections                  |           |
      | payload:                            |           |
      |   collection: role_preset_notes     |           |
      |   schema: {}                        |           |
      |   meta: {}                          |           |
      |   fields:                           |           |
      |     - field: label                  |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      |     - field: note                   |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      |     - field: tag                    |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <parent-policy>               |           |
      |   name: parent-<run>                |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: role_preset_notes |           |
      |       action: create                |           |
      |       fields: ['*']                 |           |
      |       presets:                      |           |
      |         label: from the parent      |           |
      |         note: from the parent       |           |
      |         tag: from the parent        |           |
      |     - collection: role_preset_notes |           |
      |       action: read                  |           |
      |       fields: ['*']                 |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <child-policy>                |           |
      |   name: child-<run>                 |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: role_preset_notes |           |
      |       action: create                |           |
      |       fields: ['*']                 |           |
      |       presets:                      |           |
      |         label: from the child       |           |
      |         note: from the child        |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <user-policy>                 |           |
      |   name: user-<run>                  |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: role_preset_notes |           |
      |       action: create                |           |
      |       fields: ['*']                 |           |
      |       presets:                      |           |
      |         label: from the user        |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <parent-role>                 |           |
      |   name: parent-<run>                |           |
      |   policies:                         |           |
      |     - policy: <parent-policy>       |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <child-role>                  |           |
      |   name: child-<run>                 |           |
      |   parent: <parent-role>             |           |
      |   policies:                         |           |
      |     - policy: <child-policy>        |           |
      | method: POST                        | code: 200 |+
      | path: /users                        |           |
      | payload:                            |           |
      |   email: preset-<run>@example.com   |           |
      |   role: <child-role>                |           |
      |   token: preset-<run>               |           |
      |   policies:                         |           |
      |     - policy: <user-policy>         |           |
    Then these requests get these responses:
      | request                                      | response                 |
      | as: preset-<run>                             | code: 200                |+
      | method: POST                                 |                          |
      | path: /items/role_preset_notes               |                          |
      | payload: {}                                  |                          |
      | remember: preset-note                        |                          |
      | as: preset-<run>                             | code: 200                |+
      | method: GET                                  | body:                    |
      | path: /items/role_preset_notes/<preset-note> |   data:                  |
      | query:                                       |     label: from the user |
      |   fields: label,note,tag                     |     note: from the child |
      |                                              |     tag: from the parent |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete | with |
      | 1       | directus_access      | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields      | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_relations   | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles       | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_users       | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns     | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema   | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint        | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index             | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc              | 1      | 0      | 0      | 0      | 0    |
      | 1       | role_preset_notes    | 1      | 1      | 0      | 0      | 0    |
      | 2       | directus_users       | 1      | 0      | 0      | 0      | 0    |
      | 2       | role_preset_notes    | 1      | 0      | 0      | 0      | 0    |

  Scenario: the role variables resolve to the user's role and its chain
    Given these requests are sent:
      | request                               | response  |
      | method: POST                          | code: 200 |+
      | path: /collections                    |           |
      | payload:                              |           |
      |   collection: role_variable_notes     |           |
      |   schema: {}                          |           |
      |   meta: {}                            |           |
      |   fields:                             |           |
      |     - field: label                    |           |
      |       type: string                    |           |
      |       meta: {}                        |           |
      |     - field: role_tag                 |           |
      |       type: string                    |           |
      |       meta: {}                        |           |
      |     - field: created_role             |           |
      |       type: uuid                      |           |
      |       meta:                           |           |
      |         special: [role-created]       |           |
      | method: POST                          | code: 200 |+
      | path: /policies                       |           |
      | payload:                              |           |
      |   id: <child-policy>                  |           |
      |   name: child-<run>                   |           |
      |   app_access: false                   |           |
      |   admin_access: false                 |           |
      |   permissions:                        |           |
      |     - collection: role_variable_notes |           |
      |       action: read                    |           |
      |       fields: ['*']                   |           |
      |       permissions:                    |           |
      |         role_tag:                     |           |
      |           _in: $CURRENT_ROLES         |           |
      |     - collection: role_variable_notes |           |
      |       action: create                  |           |
      |       fields: ['*']                   |           |
      |       validation:                     |           |
      |         role_tag:                     |           |
      |           _eq: $CURRENT_ROLE          |           |
      |       presets:                        |           |
      |         role_tag: $CURRENT_ROLE       |           |
      | method: POST                          | code: 200 |+
      | path: /roles                          |           |
      | payload:                              |           |
      |   id: <parent-role>                   |           |
      |   name: parent-<run>                  |           |
      | method: POST                          | code: 200 |+
      | path: /roles                          |           |
      | payload:                              |           |
      |   id: <child-role>                    |           |
      |   name: child-<run>                   |           |
      |   parent: <parent-role>               |           |
      |   policies:                           |           |
      |     - policy: <child-policy>          |           |
      | method: POST                          | code: 200 |+
      | path: /users                          |           |
      | payload:                              |           |
      |   email: variable-<run>@example.com   |           |
      |   role: <child-role>                  |           |
      |   token: variable-<run>               |           |
      | method: POST                          | code: 200 |+
      | path: /items/role_variable_notes      |           |
      | payload:                              |           |
      |   - label: parent row                 |           |
      |     role_tag: <parent-role>           |           |
      |   - label: child row                  |           |
      |     role_tag: <child-role>            |           |
      |   - label: other row                  |           |
      |     role_tag: <other-role>            |           |
    Then these requests get these responses:
      | request                                | response                            |
      | as: variable-<run>                     | code: 200                           |+
      | method: GET                            | body:                               |
      | path: /items/role_variable_notes       |   data:                             |
      | query:                                 |     - label: child row              |
      |   fields: label                        |     - label: parent row             |
      |   sort: label                          |                                     |
      | as: variable-<run>                     | code: 200                           |+
      | method: GET                            | body:                               |
      | path: /items/role_variable_notes       |   data:                             |
      | query:                                 |     - label: child row              |
      |   fields: label                        |                                     |
      |   filter[role_tag][_eq]: $CURRENT_ROLE |                                     |
      | as: variable-<run>                     | code: 400                           |+
      | method: POST                           | body:                               |
      | path: /items/role_variable_notes       |   errors:                           |
      | payload:                               |     - message: >-                   |
      |   label: parent-tagged                 |         Validation failed for field |
      |   role_tag: <parent-role>              |         "role_tag". Value has to be |
      |                                        |         "<child-role>".             |
      | as: variable-<run>                     | code: 200                           |+
      | method: POST                           |                                     |
      | path: /items/role_variable_notes       |                                     |
      | payload:                               |                                     |
      |   label: preset row                    |                                     |
      | method: GET                            | code: 200                           |+
      | path: /items/role_variable_notes       | body:                               |
      | query:                                 |   data:                             |
      |   fields: role_tag,created_role        |     - role_tag: <child-role>        |
      |   filter[label][_eq]: preset row       |       created_role: <child-role>    |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions | 2      | 0      | 0      | 0      |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      |
      | 1       | directus_roles       | 2      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 1       | role_variable_notes  | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | role_variable_notes  | 1      | 0      | 0      | 0      |
      | 3       | directus_permissions | 1      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | directus_activity    | 0      | 1      | 0      | 0      |
      | 4       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 4       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | role_variable_notes  | 1      | 1      | 0      | 0      |
      | 5       | directus_users       | 1      | 0      | 0      | 0      |
      | 5       | role_variable_notes  | 1      | 0      | 0      | 0      |

  Scenario: an app user reads the presets of their own role, not the parent's
    Given these requests are sent:
      | request                        | response  |
      | method: POST                   | code: 200 |+
      | path: /policies                |           |
      | payload:                       |           |
      |   id: <app-policy>             |           |
      |   name: app-<run>              |           |
      |   app_access: true             |           |
      |   admin_access: false          |           |
      | method: POST                   | code: 200 |+
      | path: /roles                   |           |
      | payload:                       |           |
      |   id: <parent-role>            |           |
      |   name: parent-<run>           |           |
      | method: POST                   | code: 200 |+
      | path: /roles                   |           |
      | payload:                       |           |
      |   id: <child-role>             |           |
      |   name: child-<run>            |           |
      |   parent: <parent-role>        |           |
      |   policies:                    |           |
      |     - policy: <app-policy>     |           |
      | method: POST                   | code: 200 |+
      | path: /users                   |           |
      | payload:                       |           |
      |   email: app-<run>@example.com |           |
      |   role: <child-role>           |           |
      |   token: app-<run>             |           |
      | method: POST                   | code: 200 |+
      | path: /presets                 |           |
      | payload:                       |           |
      |   - bookmark: child-<run>      |           |
      |     collection: directus_users |           |
      |     role: <child-role>         |           |
      |   - bookmark: parent-<run>     |           |
      |     collection: directus_users |           |
      |     role: <parent-role>        |           |
      |   - bookmark: everyone-<run>   |           |
      |     collection: directus_users |           |
    Then these requests get these responses:
      | request                                | response                       |
      | as: app-<run>                          | code: 200                      |+
      | method: GET                            | body:                          |
      | path: /presets                         |   data:                        |
      | query:                                 |     - bookmark: child-<run>    |
      |   fields: bookmark                     |     - bookmark: everyone-<run> |
      |   sort: bookmark                       |                                |
      |   filter[bookmark][_ends_with]: -<run> |                                |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions | 2      | 0      | 0      | 0      |
      | 1       | directus_policies    | 1      | 0      | 0      | 0      |
      | 1       | directus_presets     | 1      | 0      | 0      | 0      |
      | 1       | directus_roles       | 2      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
