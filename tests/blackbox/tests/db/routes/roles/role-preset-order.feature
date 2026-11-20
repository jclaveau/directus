Feature: The presets of several member roles apply parents first, then leaves

  - Presets apply role after role, the last one winning on a field: first the
    parents, every role that is an ancestor of another role of the user, root
    first; then the leaf roles, the member roles that are no ancestor of
    another, by membership `sort`. A member role that is also the parent of
    another member role counts as a parent (#746).
  - A policy reached through several member roles counts at its last place
    in that order.
  - A role given by an invite or a login provider goes after the user's
    other roles: its membership `sort` is one past the user's highest.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a leaf role's preset beats the parent of another member role
    Given the rows of directus_policies:
      | id          | name          | app_access | admin_access |
      | <p-staff>   | staff-<run>   | false      | false        |
      | <p-press>   | press-<run>   | false      | false        |
      | <p-editors> | editors-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy      | collection       | action | fields | presets                   |
      | <p-staff>   | role_order_notes | create | *      | {"visibility":"internal"} |
      | <p-press>   | role_order_notes | create | *      | {"visibility":"public"}   |
      | <p-press>   | role_order_notes | read   | *      |                           |
      | <p-editors> | role_order_notes | create | *      | {"lang":"fr"}             |
    And the rows of directus_roles:
      | id        | name          | parent  |
      | <staff>   | staff-<run>   |         |
      | <press>   | press-<run>   |         |
      | <editors> | editors-<run> | <staff> |
    And the rows of directus_access:
      | id         | role      | policy      |
      | <access-1> | <staff>   | <p-staff>   |
      | <access-2> | <press>   | <p-press>   |
      | <access-3> | <editors> | <p-editors> |
    And the rows of directus_users:
      | id      | email                   | token       |
      | <alice> | alice-<run>@example.com | alice-<run> |
    And the rows of directus_role_members:
      | id         | user    | role      | sort |
      | <member-1> | <alice> | <press>   | 1    |
      | <member-2> | <alice> | <editors> | 2    |
    Then these requests get these responses:
      | request                                    | response               |
      | as: alice-<run>                            | code: 200              |+
      | method: POST                               |                        |
      | path: /items/role_order_notes              |                        |
      | payload: {}                                |                        |
      | remember: alice-note                       |                        |
      | as: alice-<run>                            | code: 200              |+
      | method: GET                                | body:                  |
      | path: /items/role_order_notes/<alice-note> |   data:                |
      | query:                                     |     visibility: public |
      |   fields: visibility,lang                  |     lang: fr           |
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
      | 1       | directus_roles        | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | role_order_notes      | 1      | 1      | 0      | 0      | 0    |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 2       | role_order_notes      | 1      | 0      | 0      | 0      | 0    |

  Scenario: a member role that is the parent of another one counts as a parent
    Given the rows of directus_policies:
      | id          | name          | app_access | admin_access |
      | <p-staff>   | staff-<run>   | false      | false        |
      | <p-editors> | editors-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy      | collection       | action | fields | presets                   |
      | <p-staff>   | role_order_notes | create | *      | {"visibility":"internal"} |
      | <p-staff>   | role_order_notes | read   | *      |                           |
      | <p-editors> | role_order_notes | create | *      | {"visibility":"external"} |
    And the rows of directus_roles:
      | id        | name          | parent  |
      | <staff>   | staff-<run>   |         |
      | <editors> | editors-<run> | <staff> |
    And the rows of directus_access:
      | id         | role      | policy      |
      | <access-1> | <staff>   | <p-staff>   |
      | <access-2> | <editors> | <p-editors> |
    And the rows of directus_users:
      | id    | email                 | token     |
      | <bob> | bob-<run>@example.com | bob-<run> |
    And the rows of directus_role_members:
      | id         | user  | role      | sort |
      | <member-1> | <bob> | <editors> | 1    |
      | <member-2> | <bob> | <staff>   | 2    |
    Then these requests get these responses:
      | request                                  | response                 |
      | as: bob-<run>                            | code: 200                |+
      | method: POST                             |                          |
      | path: /items/role_order_notes            |                          |
      | payload: {}                              |                          |
      | remember: bob-note                       |                          |
      | as: bob-<run>                            | code: 200                |+
      | method: GET                              | body:                    |
      | path: /items/role_order_notes/<bob-note> |   data:                  |
      | query:                                   |     visibility: external |
      |   fields: visibility                     |                          |
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
      | 1       | directus_roles        | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | role_order_notes      | 1      | 1      | 0      | 0      | 0    |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 2       | role_order_notes      | 1      | 0      | 0      | 0      | 0    |

  Scenario: between two leaf roles the later sort wins, not the deeper chain
    Given the rows of directus_policies:
      | id          | name          | app_access | admin_access |
      | <p-press>   | press-<run>   | false      | false        |
      | <p-editors> | editors-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy      | collection       | action | fields | presets                   |
      | <p-press>   | role_order_notes | create | *      | {"visibility":"public"}   |
      | <p-press>   | role_order_notes | read   | *      |                           |
      | <p-editors> | role_order_notes | create | *      | {"visibility":"internal"} |
    And the rows of directus_roles:
      | id        | name          | parent    |
      | <company> | company-<run> |           |
      | <staff>   | staff-<run>   | <company> |
      | <editors> | editors-<run> | <staff>   |
      | <press>   | press-<run>   |           |
    And the rows of directus_access:
      | id         | role      | policy      |
      | <access-1> | <press>   | <p-press>   |
      | <access-2> | <editors> | <p-editors> |
    And the rows of directus_users:
      | id      | email                   | token       |
      | <carol> | carol-<run>@example.com | carol-<run> |
    And the rows of directus_role_members:
      | id         | user    | role      | sort |
      | <member-1> | <carol> | <editors> | 1    |
      | <member-2> | <carol> | <press>   | 2    |
    Then these requests get these responses:
      | request                                    | response               |
      | as: carol-<run>                            | code: 200              |+
      | method: POST                               |                        |
      | path: /items/role_order_notes              |                        |
      | payload: {}                                |                        |
      | remember: carol-note                       |                        |
      | as: carol-<run>                            | code: 200              |+
      | method: GET                                | body:                  |
      | path: /items/role_order_notes/<carol-note> |   data:                |
      | query:                                     |     visibility: public |
      |   fields: visibility                       |                        |
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
      | 1       | directus_roles        | 4      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | role_order_notes      | 1      | 1      | 0      | 0      | 0    |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 2       | role_order_notes      | 1      | 0      | 0      | 0      | 0    |

  Scenario: a policy reached through two member roles counts at its last one
    Given the rows of directus_policies:
      | id      | name      | app_access | admin_access |
      | <p-pub> | pub-<run> | false      | false        |
      | <p-rev> | rev-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy  | collection       | action | fields | presets             |
      | <p-pub> | role_order_notes | create | *      | {"status":"draft"}  |
      | <p-pub> | role_order_notes | read   | *      |                     |
      | <p-rev> | role_order_notes | create | *      | {"status":"review"} |
    And the rows of directus_roles:
      | id           | name             | parent  |
      | <staff>      | staff-<run>      |         |
      | <editors-fr> | editors-fr-<run> | <staff> |
      | <press>      | press-<run>      |         |
    And the rows of directus_access:
      | id         | role         | policy  |
      | <access-1> | <staff>      | <p-pub> |
      | <access-2> | <editors-fr> | <p-rev> |
      | <access-3> | <press>      | <p-pub> |
    And the rows of directus_users:
      | id      | email                   | token       |
      | <alice> | alice-<run>@example.com | alice-<run> |
    And the rows of directus_role_members:
      | id         | user    | role         | sort |
      | <member-1> | <alice> | <editors-fr> | 1    |
      | <member-2> | <alice> | <press>      | 2    |
    Then these requests get these responses:
      | request                                    | response          |
      | as: alice-<run>                            | code: 200         |+
      | method: POST                               |                   |
      | path: /items/role_order_notes              |                   |
      | payload: {}                                |                   |
      | remember: alice-note                       |                   |
      | as: alice-<run>                            | code: 200         |+
      | method: GET                                | body:             |
      | path: /items/role_order_notes/<alice-note> |   data:           |
      | query:                                     |     status: draft |
      |   fields: status                           |                   |
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
      | 1       | directus_roles        | 3      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 1       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 1       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 1       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 1       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 1       | role_order_notes      | 1      | 1      | 0      | 0      | 0    |
      | 2       | directus_users        | 1      | 0      | 0      | 0      | 0    |
      | 2       | role_order_notes      | 1      | 0      | 0      | 0      | 0    |

  Scenario: an invited role's preset beats a role given by hand before it
    Given the rows of directus_policies:
      | id        | name        | app_access | admin_access |
      | <p-staff> | staff-<run> | false      | false        |
      | <p-press> | press-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy    | collection       | action | fields | presets                   |
      | <p-staff> | role_order_notes | create | *      | {"visibility":"internal"} |
      | <p-staff> | role_order_notes | read   | *      |                           |
      | <p-press> | role_order_notes | create | *      | {"visibility":"public"}   |
    And the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
      | <press> | press-<run> |
    And the rows of directus_access:
      | id         | role    | policy    |
      | <access-1> | <staff> | <p-staff> |
      | <access-2> | <press> | <p-press> |
    And the rows of directus_users:
      | id      | email                   | token       | status  |
      | <alice> | alice-<run>@example.com | alice-<run> | invited |
    And the rows of directus_role_members:
      | id         | user    | role    | sort |
      | <member-1> | <alice> | <staff> | 1    |
    Then these requests get these responses:
      | request                                    | response               |
      | method: POST                               | code: 204              |+
      | path: /users/invite                        |                        |
      | payload:                                   |                        |
      |   email: alice-<run>@example.com           |                        |
      |   roles:                                   |                        |
      |     - <press>                              |                        |
      | method: PATCH                              | code: 200              |+
      | path: /users/<alice>                       |                        |
      | payload:                                   |                        |
      |   status: active                           |                        |
      | as: alice-<run>                            | code: 200              |+
      | method: POST                               |                        |
      | path: /items/role_order_notes              |                        |
      | payload: {}                                |                        |
      | remember: alice-note                       |                        |
      | as: alice-<run>                            | code: 200              |+
      | method: GET                                | body:                  |
      | path: /items/role_order_notes/<alice-note> |   data:                |
      | query:                                     |     visibility: public |
      |   fields: visibility                       |                        |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 3       | directus_access       | 3      | 0      | 0      | 0      |
      | 3       | directus_activity     | 0      | 1      | 0      | 0      |
      | 3       | directus_permissions  | 3      | 0      | 0      | 0      |
      | 3       | directus_policies     | 1      | 0      | 0      | 0      |
      | 3       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 3       | directus_role_members | 1      | 0      | 0      | 0      |
      | 3       | directus_roles        | 2      | 0      | 0      | 0      |
      | 3       | directus_users        | 1      | 0      | 0      | 0      |
      | 3       | role_order_notes      | 1      | 1      | 0      | 0      |
      | 4       | directus_users        | 1      | 0      | 0      | 0      |
      | 4       | role_order_notes      | 1      | 0      | 0      | 0      |
