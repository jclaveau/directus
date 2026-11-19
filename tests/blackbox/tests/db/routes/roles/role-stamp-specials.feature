Feature: The role stamps list the member roles that allowed the write

  - A user can hold several roles (#746): `roles-created` and `roles-updated`
    stamp a json list of the member roles whose policies allowed the create
    or the update, by membership `sort`. A policy a member role inherits
    from its parent counts as that member role's, a policy given to the user
    directly counts as no role's. An admin's are the member roles giving it
    admin access.
  - An update counts a role only when its policy's item rule matches the row
    as it was before the write, and lets it set at least one written field.
    Each row is stamped with the roles allowing it, a batch update too.
  - The `role-created` and `role-updated` specials are removed: a field
    written with one is refused.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.

  Scenario: a policy inherited from a parent role counts as the member role
    Given these requests are sent:
      | request                                 | response  |
      | method: POST                            | code: 200 |+
      | path: /collections                      |           |
      | payload:                                |           |
      |   collection: stamp_inherited_notes     |           |
      |   schema: {}                            |           |
      |   meta: {}                              |           |
      |   fields:                               |           |
      |     - field: label                      |           |
      |       type: string                      |           |
      |       meta: {}                          |           |
      |     - field: created_roles              |           |
      |       type: json                        |           |
      |       meta:                             |           |
      |         special:                        |           |
      |           - cast-json                   |           |
      |           - roles-created               |           |
      | method: POST                            | code: 200 |+
      | path: /policies                         |           |
      | payload:                                |           |
      |   id: <staff-policy>                    |           |
      |   name: staff-<run>                     |           |
      |   app_access: false                     |           |
      |   admin_access: false                   |           |
      |   permissions:                          |           |
      |     - collection: stamp_inherited_notes |           |
      |       action: create                    |           |
      |       fields: ['*']                     |           |
      |     - collection: stamp_inherited_notes |           |
      |       action: read                      |           |
      |       fields: ['*']                     |           |
      | method: POST                            | code: 200 |+
      | path: /roles                            |           |
      | payload:                                |           |
      |   id: <staff-role>                      |           |
      |   name: staff-<run>                     |           |
      |   policies:                             |           |
      |     - policy: <staff-policy>            |           |
      | method: POST                            | code: 200 |+
      | path: /roles                            |           |
      | payload:                                |           |
      |   id: <editors-role>                    |           |
      |   name: editors-<run>                   |           |
      |   parent: <staff-role>                  |           |
      | method: POST                            | code: 200 |+
      | path: /users                            |           |
      | payload:                                |           |
      |   email: inherited-<run>@example.com    |           |
      |   token: inherited-<run>                |           |
      |   roles:                                |           |
      |     - role: <editors-role>              |           |
      |       sort: 1                           |           |
    Then these requests get these responses:
      | request                            | response               |
      | as: inherited-<run>                | code: 200              |+
      | method: POST                       | body:                  |
      | path: /items/stamp_inherited_notes |   data:                |
      | payload:                           |     created_roles:     |
      |   label: first                     |       - <editors-role> |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_access       | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions  | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | stamp_inherited_notes | 1      | 1      | 0      | 0      | 0    |

  Scenario: a policy given to the user directly counts as no role
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /collections                   |           |
      | payload:                             |           |
      |   collection: stamp_direct_notes     |           |
      |   schema: {}                         |           |
      |   meta: {}                           |           |
      |   fields:                            |           |
      |     - field: label                   |           |
      |       type: string                   |           |
      |       meta: {}                       |           |
      |     - field: created_roles           |           |
      |       type: json                     |           |
      |       meta:                          |           |
      |         special:                     |           |
      |           - cast-json                |           |
      |           - roles-created            |           |
      | method: POST                         | code: 200 |+
      | path: /policies                      |           |
      | payload:                             |           |
      |   id: <direct-policy>                |           |
      |   name: direct-<run>                 |           |
      |   app_access: false                  |           |
      |   admin_access: false                |           |
      |   permissions:                       |           |
      |     - collection: stamp_direct_notes |           |
      |       action: create                 |           |
      |       fields: ['*']                  |           |
      |     - collection: stamp_direct_notes |           |
      |       action: read                   |           |
      |       fields: ['*']                  |           |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <plain-role>                   |           |
      |   name: plain-<run>                  |           |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   email: direct-<run>@example.com    |           |
      |   token: direct-<run>                |           |
      |   roles:                             |           |
      |     - role: <plain-role>             |           |
      |       sort: 1                        |           |
      |   policies:                          |           |
      |     - policy: <direct-policy>        |           |
    Then these requests get these responses:
      | request                         | response              |
      | as: direct-<run>                | code: 200             |+
      | method: POST                    | body:                 |
      | path: /items/stamp_direct_notes |   data:               |
      | payload:                        |     created_roles: [] |
      |   label: first                  |                       |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_access       | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions  | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | stamp_direct_notes    | 1      | 1      | 0      | 0      | 0    |

  Scenario: an update counts only the roles whose rule matches the row
    Given these requests are sent:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /collections                     |           |
      | payload:                               |           |
      |   collection: stamp_reviewed_notes     |           |
      |   schema: {}                           |           |
      |   meta: {}                             |           |
      |   fields:                              |           |
      |     - field: label                     |           |
      |       type: string                     |           |
      |       meta: {}                         |           |
      |     - field: status                    |           |
      |       type: string                     |           |
      |       meta: {}                         |           |
      |     - field: updated_roles             |           |
      |       type: json                       |           |
      |       meta:                            |           |
      |         special:                       |           |
      |           - cast-json                  |           |
      |           - roles-updated              |           |
      | method: POST                           | code: 200 |+
      | path: /items/stamp_reviewed_notes      |           |
      | remember: published-note               |           |
      | payload:                               |           |
      |   label: published                     |           |
      |   status: published                    |           |
      | method: POST                           | code: 200 |+
      | path: /items/stamp_reviewed_notes      |           |
      | remember: draft-note                   |           |
      | payload:                               |           |
      |   label: draft                         |           |
      |   status: draft                        |           |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <editors-policy>                 |           |
      |   name: editors-<run>                  |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      |   permissions:                         |           |
      |     - collection: stamp_reviewed_notes |           |
      |       action: update                   |           |
      |       fields: ['*']                    |           |
      |       permissions:                     |           |
      |         status:                        |           |
      |           _eq: draft                   |           |
      |     - collection: stamp_reviewed_notes |           |
      |       action: read                     |           |
      |       fields: ['*']                    |           |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <reviewers-policy>               |           |
      |   name: reviewers-<run>                |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      |   permissions:                         |           |
      |     - collection: stamp_reviewed_notes |           |
      |       action: update                   |           |
      |       fields: ['*']                    |           |
      |       permissions: {}                  |           |
      | method: POST                           | code: 200 |+
      | path: /roles                           |           |
      | payload:                               |           |
      |   id: <editors-role>                   |           |
      |   name: editors-<run>                  |           |
      |   policies:                            |           |
      |     - policy: <editors-policy>         |           |
      | method: POST                           | code: 200 |+
      | path: /roles                           |           |
      | payload:                               |           |
      |   id: <reviewers-role>                 |           |
      |   name: reviewers-<run>                |           |
      |   policies:                            |           |
      |     - policy: <reviewers-policy>       |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   email: reviewed-<run>@example.com    |           |
      |   token: reviewed-<run>                |           |
      |   roles:                               |           |
      |     - role: <editors-role>             |           |
      |       sort: 1                          |           |
      |     - role: <reviewers-role>           |           |
      |       sort: 2                          |           |
    Then these requests get these responses:
      | request                                            | response                 |
      | as: reviewed-<run>                                 | code: 200                |+
      | method: PATCH                                      | body:                    |
      | path: /items/stamp_reviewed_notes/<published-note> |   data:                  |
      | payload:                                           |     updated_roles:       |
      |   label: reviewed                                  |       - <reviewers-role> |
      | as: reviewed-<run>                                 | code: 200                |+
      | method: PATCH                                      | body:                    |
      | path: /items/stamp_reviewed_notes/<draft-note>     |   data:                  |
      | payload:                                           |     updated_roles:       |
      |   label: edited                                    |       - <editors-role>   |
      |                                                    |       - <reviewers-role> |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_access       | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions  | 4      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | stamp_reviewed_notes  | 4      | 0      | 1      | 0      | 0    |
      | 2       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 2       | directus_revisions    | 0      | 1      | 0      | 0      | 0    |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 2       | stamp_reviewed_notes  | 4      | 0      | 1      | 0      | 0    |

  Scenario: an update stamps each row with the roles whose rule matches it
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /collections                  |           |
      | payload:                            |           |
      |   collection: stamp_split_notes     |           |
      |   schema: {}                        |           |
      |   meta: {}                          |           |
      |   fields:                           |           |
      |     - field: label                  |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      |     - field: status                 |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      |     - field: updated_roles          |           |
      |       type: json                    |           |
      |       meta:                         |           |
      |         special:                    |           |
      |           - cast-json               |           |
      |           - roles-updated           |           |
      | method: POST                        | code: 200 |+
      | path: /items/stamp_split_notes      |           |
      | remember: draft-note                |           |
      | payload:                            |           |
      |   label: draft                      |           |
      |   status: draft                     |           |
      | method: POST                        | code: 200 |+
      | path: /items/stamp_split_notes      |           |
      | remember: review-note               |           |
      | payload:                            |           |
      |   label: review                     |           |
      |   status: review                    |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <editors-policy>              |           |
      |   name: editors-<run>               |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: stamp_split_notes |           |
      |       action: update                |           |
      |       fields: ['*']                 |           |
      |       permissions:                  |           |
      |         status:                     |           |
      |           _eq: draft                |           |
      |     - collection: stamp_split_notes |           |
      |       action: read                  |           |
      |       fields: ['*']                 |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <reviewers-policy>            |           |
      |   name: reviewers-<run>             |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: stamp_split_notes |           |
      |       action: update                |           |
      |       fields: ['*']                 |           |
      |       permissions:                  |           |
      |         status:                     |           |
      |           _eq: review               |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <editors-role>                |           |
      |   name: editors-<run>               |           |
      |   policies:                         |           |
      |     - policy: <editors-policy>      |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <reviewers-role>              |           |
      |   name: reviewers-<run>             |           |
      |   policies:                         |           |
      |     - policy: <reviewers-policy>    |           |
      | method: POST                        | code: 200 |+
      | path: /users                        |           |
      | payload:                            |           |
      |   email: split-<run>@example.com    |           |
      |   token: split-<run>                |           |
      |   roles:                            |           |
      |     - role: <editors-role>          |           |
      |       sort: 1                       |           |
      |     - role: <reviewers-role>        |           |
      |       sort: 2                       |           |
    Then these requests get these responses:
      | request                              | response                   |
      | as: split-<run>                      | code: 200                  |+
      | method: PATCH                        |                            |
      | path: /items/stamp_split_notes       |                            |
      | payload:                             |                            |
      |   keys:                              |                            |
      |     - <draft-note>                   |                            |
      |     - <review-note>                  |                            |
      |   data:                              |                            |
      |     label: checked                   |                            |
      | method: GET                          | code: 200                  |+
      | path: /items/stamp_split_notes       | body:                      |
      | query:                               |   data:                    |
      |   fields: label,status,updated_roles |     - label: checked       |
      |   sort: status                       |       status: draft        |
      |                                      |       updated_roles:       |
      |                                      |         - <editors-role>   |
      |                                      |     - label: checked       |
      |                                      |       status: review       |
      |                                      |       updated_roles:       |
      |                                      |         - <reviewers-role> |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_access       | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions  | 4      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | stamp_split_notes     | 5      | 0      | 1      | 0      | 0    |
      | 2       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 2       | directus_role_members | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 2       | stamp_split_notes     | 1      | 0      | 0      | 0      | 0    |

  Scenario: an update counts only the roles allowed to set a written field
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /collections                  |           |
      | payload:                            |           |
      |   collection: stamp_field_notes     |           |
      |   schema: {}                        |           |
      |   meta: {}                          |           |
      |   fields:                           |           |
      |     - field: label                  |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      |     - field: note                   |           |
      |       type: string                  |           |
      |       meta: {}                      |           |
      |     - field: updated_roles          |           |
      |       type: json                    |           |
      |       meta:                         |           |
      |         special:                    |           |
      |           - cast-json               |           |
      |           - roles-updated           |           |
      | method: POST                        | code: 200 |+
      | path: /items/stamp_field_notes      |           |
      | remember: field-note                |           |
      | payload:                            |           |
      |   label: first                      |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <editors-policy>              |           |
      |   name: editors-<run>               |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: stamp_field_notes |           |
      |       action: update                |           |
      |       fields: [label]               |           |
      |     - collection: stamp_field_notes |           |
      |       action: read                  |           |
      |       fields: ['*']                 |           |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <reviewers-policy>            |           |
      |   name: reviewers-<run>             |           |
      |   app_access: false                 |           |
      |   admin_access: false               |           |
      |   permissions:                      |           |
      |     - collection: stamp_field_notes |           |
      |       action: update                |           |
      |       fields: [note]                |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <editors-role>                |           |
      |   name: editors-<run>               |           |
      |   policies:                         |           |
      |     - policy: <editors-policy>      |           |
      | method: POST                        | code: 200 |+
      | path: /roles                        |           |
      | payload:                            |           |
      |   id: <reviewers-role>              |           |
      |   name: reviewers-<run>             |           |
      |   policies:                         |           |
      |     - policy: <reviewers-policy>    |           |
      | method: POST                        | code: 200 |+
      | path: /users                        |           |
      | payload:                            |           |
      |   email: field-<run>@example.com    |           |
      |   token: field-<run>                |           |
      |   roles:                            |           |
      |     - role: <editors-role>          |           |
      |       sort: 1                       |           |
      |     - role: <reviewers-role>        |           |
      |       sort: 2                       |           |
    Then these requests get these responses:
      | request                                     | response                 |
      | as: field-<run>                             | code: 200                |+
      | method: PATCH                               | body:                    |
      | path: /items/stamp_field_notes/<field-note> |   data:                  |
      | payload:                                    |     updated_roles:       |
      |   label: labelled                           |       - <editors-role>   |
      |   note: noted                               |       - <reviewers-role> |
      | as: field-<run>                             | code: 200                |+
      | method: PATCH                               | body:                    |
      | path: /items/stamp_field_notes/<field-note> |   data:                  |
      | payload:                                    |     updated_roles:       |
      |   label: relabelled                         |       - <editors-role>   |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_access       | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_permissions  | 4      | 0      | 0      | 0      | 0    |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | stamp_field_notes     | 3      | 0      | 1      | 0      | 0    |
      | 2       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 2       | directus_revisions    | 0      | 1      | 0      | 0      | 0    |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 2       | stamp_field_notes     | 3      | 0      | 1      | 0      | 0    |

  Scenario: an admin records the member roles giving it admin access
    Given these requests are sent:
      | request                         | response  |
      | method: POST                    | code: 200 |+
      | path: /collections              |           |
      | payload:                        |           |
      |   collection: stamp_admin_notes |           |
      |   schema: {}                    |           |
      |   meta: {}                      |           |
      |   fields:                       |           |
      |     - field: label              |           |
      |       type: string              |           |
      |       meta: {}                  |           |
      |     - field: created_roles      |           |
      |       type: json                |           |
      |       meta:                     |           |
      |         special:                |           |
      |           - cast-json           |           |
      |           - roles-created       |           |
    Then these requests get these responses:
      | request                        | response                                     |
      | as: TestsFlowToken             | code: 200                                    |+
      | method: POST                   | body:                                        |
      | path: /items/stamp_admin_notes |   data:                                      |
      | payload:                       |     created_roles:                           |
      |   label: first                 |       - d70c0943-5b55-4c5d-a613-f539a27a57f5 |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 2      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | stamp_admin_notes     | 1      | 1      | 0      | 0      |

  Scenario: a field written with a removed role special is refused
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /collections                |           |
      | payload:                          |           |
      |   collection: stamp_refused_notes |           |
      |   schema: {}                      |           |
      |   meta: {}                        |           |
      |   fields:                         |           |
      |     - field: label                |           |
      |       type: string                |           |
      |       meta: {}                    |           |
    Then these requests get these responses:
      | request                           | response                                  |
      | method: POST                      | code: 400                                 |+
      | path: /fields/stamp_refused_notes | body:                                     |
      | payload:                          |   errors:                                 |
      |   field: made_by_role             |     - message: >-                         |
      |   type: uuid                      |         Invalid payload. Field            |
      |   meta:                           |         "made_by_role" of collection      |
      |     special:                      |         "stamp_refused_notes" uses the    |
      |       - role-created              |         removed special "role-created": a |
      |                                   |         user can hold several roles, use  |
      |                                   |         "roles-created" on a json field.  |
      | method: POST                      | code: 400                                 |+
      | path: /fields/stamp_refused_notes | body:                                     |
      | payload:                          |   errors:                                 |
      |   field: changed_by_role          |     - message: >-                         |
      |   type: uuid                      |         Invalid payload. Field            |
      |   meta:                           |         "changed_by_role" of collection   |
      |     special:                      |         "stamp_refused_notes" uses the    |
      |       - role-updated              |         removed special "role-updated": a |
      |                                   |         user can hold several roles, use  |
      |                                   |         "roles-updated" on a json field.  |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | alter |
      | 1       | directus_access       | 2      | 0      | 0      | 0      | 0     |
      | 1       | directus_fields       | 2      | 0      | 0      | 0      | 0     |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      | 0     |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      | 0     |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0     |
      | 1       | stamp_refused_notes   | 0      | 0      | 0      | 0      | 1     |
      | 2       | directus_access       | 2      | 0      | 0      | 0      | 0     |
      | 2       | directus_collections  | 1      | 0      | 0      | 0      | 0     |
      | 2       | directus_fields       | 3      | 0      | 0      | 0      | 0     |
      | 2       | directus_relations    | 1      | 0      | 0      | 0      | 0     |
      | 2       | directus_role_members | 1      | 0      | 0      | 0      | 0     |
      | 2       | directus_roles        | 1      | 0      | 0      | 0      | 0     |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0     |
      | 2       | geometry_columns      | 0      | 0      | 0      | 0      | 0     |
      | 2       | information_schema    | 1      | 0      | 0      | 0      | 0     |
      | 2       | pg_constraint         | 1      | 0      | 0      | 0      | 0     |
      | 2       | pg_index              | 2      | 0      | 0      | 0      | 0     |
      | 2       | pg_proc               | 1      | 0      | 0      | 0      | 0     |
      | 2       | stamp_refused_notes   | 0      | 0      | 0      | 0      | 1     |
