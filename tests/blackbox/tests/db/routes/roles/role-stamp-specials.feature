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
  - A Given states the database rows a scenario starts from, written straight
    into the database; the feature's collections are created before it runs.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.

  Scenario: a policy inherited from a parent role counts as the member role
    Given the rows of directus_policies:
      | id             | name        | app_access | admin_access |
      | <staff-policy> | staff-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy         | collection            | action | fields |
      | <staff-policy> | stamp_inherited_notes | create | *      |
      | <staff-policy> | stamp_inherited_notes | read   | *      |
    And the rows of directus_roles:
      | id             | name          | parent       |
      | <staff-role>   | staff-<run>   |              |
      | <editors-role> | editors-<run> | <staff-role> |
    And the rows of directus_access:
      | id         | role         | policy         |
      | <access-1> | <staff-role> | <staff-policy> |
    And the rows of directus_users:
      | id          | email                       | token           |
      | <inherited> | inherited-<run>@example.com | inherited-<run> |
    And the rows of directus_role_members:
      | id         | user        | role           | sort |
      | <member-1> | <inherited> | <editors-role> | 1    |
    Then these requests get these responses:
      | request                            | response               |
      | as: inherited-<run>                | code: 200              |+
      | method: POST                       | body:                  |
      | path: /items/stamp_inherited_notes |   data:                |
      | payload:                           |     created_roles:     |
      |   label: first                     |       - <editors-role> |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_permissions  | 3      | 0      | 0      | 0      |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | stamp_inherited_notes | 1      | 1      | 0      | 0      |

  Scenario: a policy given to the user directly counts as no role
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <direct-policy> | direct-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection         | action | fields |
      | <direct-policy> | stamp_direct_notes | create | *      |
      | <direct-policy> | stamp_direct_notes | read   | *      |
    And the rows of directus_roles:
      | id           | name        |
      | <plain-role> | plain-<run> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <direct> | direct-<run>@example.com | direct-<run> |
    And the rows of directus_access:
      | id         | user     | policy          |
      | <access-1> | <direct> | <direct-policy> |
    And the rows of directus_role_members:
      | id         | user     | role         | sort |
      | <member-1> | <direct> | <plain-role> | 1    |
    Then these requests get these responses:
      | request                         | response              |
      | as: direct-<run>                | code: 200             |+
      | method: POST                    | body:                 |
      | path: /items/stamp_direct_notes |   data:               |
      | payload:                        |     created_roles: [] |
      |   label: first                  |                       |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_permissions  | 3      | 0      | 0      | 0      |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | stamp_direct_notes    | 1      | 1      | 0      | 0      |

  Scenario: an update counts only the roles whose rule matches the row
    Given the rows of stamp_reviewed_notes:
      | id               | label     | status    |
      | <published-note> | published | published |
      | <draft-note>     | draft     | draft     |
    And the rows of directus_policies:
      | id         | name            | app_access | admin_access |
      | <p-edit>   | editors-<run>   | false      | false        |
      | <p-review> | reviewers-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy     | collection           | action | fields | permissions                |
      | <p-edit>   | stamp_reviewed_notes | update | *      | {"status":{"_eq":"draft"}} |
      | <p-edit>   | stamp_reviewed_notes | read   | *      |                            |
      | <p-review> | stamp_reviewed_notes | update | *      | {}                         |
    And the rows of directus_roles:
      | id               | name            |
      | <editors-role>   | editors-<run>   |
      | <reviewers-role> | reviewers-<run> |
    And the rows of directus_access:
      | id         | role             | policy     |
      | <access-1> | <editors-role>   | <p-edit>   |
      | <access-2> | <reviewers-role> | <p-review> |
    And the rows of directus_users:
      | id         | email                      | token          |
      | <reviewed> | reviewed-<run>@example.com | reviewed-<run> |
    And the rows of directus_role_members:
      | id         | user       | role             | sort |
      | <member-1> | <reviewed> | <editors-role>   | 1    |
      | <member-2> | <reviewed> | <reviewers-role> | 2    |
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
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_permissions  | 4      | 0      | 0      | 0      |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | stamp_reviewed_notes  | 4      | 0      | 1      | 0      |
      | 2       | directus_activity     | 0      | 1      | 0      | 0      |
      | 2       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | stamp_reviewed_notes  | 4      | 0      | 1      | 0      |

  Scenario: an update stamps each row with the roles whose rule matches it
    Given the rows of stamp_split_notes:
      | id            | label  | status |
      | <draft-note>  | draft  | draft  |
      | <review-note> | review | review |
    And the rows of directus_policies:
      | id         | name            | app_access | admin_access |
      | <p-edit>   | editors-<run>   | false      | false        |
      | <p-review> | reviewers-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy     | collection        | action | fields | permissions                 |
      | <p-edit>   | stamp_split_notes | update | *      | {"status":{"_eq":"draft"}}  |
      | <p-edit>   | stamp_split_notes | read   | *      |                             |
      | <p-review> | stamp_split_notes | update | *      | {"status":{"_eq":"review"}} |
    And the rows of directus_roles:
      | id               | name            |
      | <editors-role>   | editors-<run>   |
      | <reviewers-role> | reviewers-<run> |
    And the rows of directus_access:
      | id         | role             | policy     |
      | <access-1> | <editors-role>   | <p-edit>   |
      | <access-2> | <reviewers-role> | <p-review> |
    And the rows of directus_users:
      | id      | email                   | token       |
      | <split> | split-<run>@example.com | split-<run> |
    And the rows of directus_role_members:
      | id         | user    | role             | sort |
      | <member-1> | <split> | <editors-role>   | 1    |
      | <member-2> | <split> | <reviewers-role> | 2    |
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
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_permissions  | 4      | 0      | 0      | 0      |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | stamp_split_notes     | 5      | 0      | 1      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | stamp_split_notes     | 1      | 0      | 0      | 0      |

  Scenario: an update counts only the roles allowed to set a written field
    Given the rows of stamp_field_notes:
      | id           | label |
      | <field-note> | first |
    And the rows of directus_policies:
      | id         | name            | app_access | admin_access |
      | <p-edit>   | editors-<run>   | false      | false        |
      | <p-review> | reviewers-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy     | collection        | action | fields |
      | <p-edit>   | stamp_field_notes | update | label  |
      | <p-edit>   | stamp_field_notes | read   | *      |
      | <p-review> | stamp_field_notes | update | note   |
    And the rows of directus_roles:
      | id               | name            |
      | <editors-role>   | editors-<run>   |
      | <reviewers-role> | reviewers-<run> |
    And the rows of directus_access:
      | id         | role             | policy     |
      | <access-1> | <editors-role>   | <p-edit>   |
      | <access-2> | <reviewers-role> | <p-review> |
    And the rows of directus_users:
      | id      | email                   | token       |
      | <field> | field-<run>@example.com | field-<run> |
    And the rows of directus_role_members:
      | id         | user    | role             | sort |
      | <member-1> | <field> | <editors-role>   | 1    |
      | <member-2> | <field> | <reviewers-role> | 2    |
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
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_permissions  | 4      | 0      | 0      | 0      |
      | 1       | directus_policies     | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 2      | 0      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | stamp_field_notes     | 3      | 0      | 1      | 0      |
      | 2       | directus_activity     | 0      | 1      | 0      | 0      |
      | 2       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | stamp_field_notes     | 3      | 0      | 1      | 0      |

  Scenario: an admin records the member roles giving it admin access
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
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 1      | 0      | 0      | 0      |
      | 2       | directus_users | 1      | 0      | 0      | 0      |
