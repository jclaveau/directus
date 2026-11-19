Feature: A user holds several roles, each one a membership

  - A user's roles are rows of `directus_role_members` (#746), written
    through the `roles` field: `roles: [{ role, sort }]`. A user gets what
    every member role's policies allow, and app access lets them read their
    own memberships. The single `role` field is gone: a write sending it is
    refused.
  - A deleted role takes its memberships along, and suspends only the users
    it leaves with no role.
  - An invitation's memberships are its inviter's: a re-invite by the same
    inviter replaces them, one by another inviter adds its own.
  - A user holds a role once per `managed_by`: a second membership of the
    same role from the same manager is refused.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a member of two roles reads what either role's policy allows
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /collections                 |           |
      | payload:                           |           |
      |   collection: membership_notes     |           |
      |   schema: {}                       |           |
      |   meta: {}                         |           |
      |   fields:                          |           |
      |     - field: label                 |           |
      |       type: string                 |           |
      |       meta: {}                     |           |
      | method: POST                       | code: 200 |+
      | path: /items/membership_notes      |           |
      | payload:                           |           |
      |   - label: first                   |           |
      |   - label: second                  |           |
      |   - label: third                   |           |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <first-policy>               |           |
      |   name: first-<run>                |           |
      |   app_access: true                 |           |
      |   admin_access: false              |           |
      |   permissions:                     |           |
      |     - collection: membership_notes |           |
      |       action: read                 |           |
      |       fields: ['*']                |           |
      |       permissions:                 |           |
      |         label:                     |           |
      |           _eq: first               |           |
      | method: POST                       | code: 200 |+
      | path: /roles                       |           |
      | payload:                           |           |
      |   id: <first-role>                 |           |
      |   name: first-<run>                |           |
      |   policies:                        |           |
      |     - policy: <first-policy>       |           |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <second-policy>              |           |
      |   name: second-<run>               |           |
      |   app_access: false                |           |
      |   admin_access: false              |           |
      |   permissions:                     |           |
      |     - collection: membership_notes |           |
      |       action: read                 |           |
      |       fields: ['*']                |           |
      |       permissions:                 |           |
      |         label:                     |           |
      |           _eq: second              |           |
      | method: POST                       | code: 200 |+
      | path: /roles                       |           |
      | payload:                           |           |
      |   id: <second-role>                |           |
      |   name: second-<run>               |           |
      |   policies:                        |           |
      |     - policy: <second-policy>      |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   email: member-<run>@example.com  |           |
      |   token: member-<run>              |           |
      |   roles:                           |           |
      |     - role: <first-role>           |           |
      |       sort: 1                      |           |
      |     - role: <second-role>          |           |
      |       sort: 2                      |           |
    Then these requests get these responses:
      | request                         | response                    |
      | as: member-<run>                | code: 200                   |+
      | method: GET                     | body:                       |
      | path: /items/membership_notes   |   data:                     |
      | query:                          |     - label: first          |
      |   fields: label                 |     - label: second         |
      |   sort: label                   |                             |
      | as: member-<run>                | code: 200                   |+
      | method: GET                     | body:                       |
      | path: /users/me                 |   data:                     |
      | query:                          |     roles:                  |
      |   fields: roles.role,roles.sort |       - role: <first-role>  |
      |                                 |         sort: 1             |
      |                                 |       - role: <second-role> |
      |                                 |         sort: 2             |

  Scenario: a user write sending the single role field is refused
    Given these requests are sent:
      | request                         | response  |
      | method: POST                    | code: 200 |+
      | path: /roles                    |           |
      | payload:                        |           |
      |   id: <refused-role>            |           |
      |   name: refused-<run>           |           |
      | method: POST                    | code: 200 |+
      | path: /users                    |           |
      | payload:                        |           |
      |   id: <kept-user>               |           |
      |   email: kept-<run>@example.com |           |
    Then these requests get these responses:
      | request                       | response                               |
      | method: POST                  | code: 400                              |+
      | path: /users                  | body:                                  |
      | payload:                      |   errors:                              |
      |   email: no-<run>@example.com |     - message: >-                      |
      |   role: <refused-role>        |         Invalid payload. "role" is     |
      |                               |         replaced by the memberships in |
      |                               |         "roles": send "roles": [{      |
      |                               |         "role": <role id> }].          |
      | method: PATCH                 | code: 400                              |+
      | path: /users/<kept-user>      | body:                                  |
      | payload:                      |   errors:                              |
      |   role: <refused-role>        |     - message: >-                      |
      |                               |         Invalid payload. "role" is     |
      |                               |         replaced by the memberships in |
      |                               |         "roles": send "roles": [{      |
      |                               |         "role": <role id> }].          |
      | method: GET                   | code: 200                              |+
      | path: /users/<kept-user>      | body:                                  |
      | query:                        |   data:                                |
      |   fields: roles               |     roles: []                          |

  Scenario: a deleted role suspends only the users it leaves with no role
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /roles                      |           |
      | payload:                          |           |
      |   id: <deleted-role>              |           |
      |   name: deleted-<run>             |           |
      | method: POST                      | code: 200 |+
      | path: /roles                      |           |
      | payload:                          |           |
      |   id: <kept-role>                 |           |
      |   name: kept-<run>                |           |
      | method: POST                      | code: 200 |+
      | path: /users                      |           |
      | payload:                          |           |
      |   id: <only-member>               |           |
      |   email: only-<run>@example.com   |           |
      |   roles:                          |           |
      |     - role: <deleted-role>        |           |
      |       sort: 1                     |           |
      | method: POST                      | code: 200 |+
      | path: /users                      |           |
      | payload:                          |           |
      |   id: <double-member>             |           |
      |   email: double-<run>@example.com |           |
      |   roles:                          |           |
      |     - role: <deleted-role>        |           |
      |       sort: 1                     |           |
      |     - role: <kept-role>           |           |
      |       sort: 2                     |           |
    Then these requests get these responses:
      | request                      | response                  |
      | method: DELETE               | code: 204                 |+
      | path: /roles/<deleted-role>  |                           |
      | method: GET                  | code: 200                 |+
      | path: /users/<only-member>   | body:                     |
      | query:                       |   data:                   |
      |   fields: status,roles.role  |     status: suspended     |
      |                              |     roles: []             |
      | method: GET                  | code: 200                 |+
      | path: /users/<double-member> | body:                     |
      | query:                       |   data:                   |
      |   fields: status,roles.role  |     status: active        |
      |                              |     roles:                |
      |                              |       - role: <kept-role> |

  Scenario: a re-invite replaces its inviter's roles, another inviter adds
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /policies                      |           |
      | payload:                             |           |
      |   id: <inviter-policy>               |           |
      |   name: inviter-<run>                |           |
      |   app_access: true                   |           |
      |   admin_access: true                 |           |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <inviter-role>                 |           |
      |   name: inviter-<run>                |           |
      |   policies:                          |           |
      |     - policy: <inviter-policy>       |           |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <role-a>                       |           |
      |   name: role-a-<run>                 |           |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <role-b>                       |           |
      |   name: role-b-<run>                 |           |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   id: <inviter-a>                    |           |
      |   email: inviter-a-<run>@example.com |           |
      |   token: inviter-a-<run>             |           |
      |   roles:                             |           |
      |     - role: <inviter-role>           |           |
      |       sort: 1                        |           |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   id: <inviter-b>                    |           |
      |   email: inviter-b-<run>@example.com |           |
      |   token: inviter-b-<run>             |           |
      |   roles:                             |           |
      |     - role: <inviter-role>           |           |
      |       sort: 1                        |           |
    Then these requests get these responses:
      | request                                    | response                 |
      | as: inviter-a-<run>                        | code: 204                |+
      | method: POST                               |                          |
      | path: /users/invite                        |                          |
      | payload:                                   |                          |
      |   email: to-<run>@example.com              |                          |
      |   roles:                                   |                          |
      |     - <role-a>                             |                          |
      | as: inviter-a-<run>                        | code: 204                |+
      | method: POST                               |                          |
      | path: /users/invite                        |                          |
      | payload:                                   |                          |
      |   email: to-<run>@example.com              |                          |
      |   roles:                                   |                          |
      |     - <role-b>                             |                          |
      | method: GET                                | code: 200                |+
      | path: /users                               | body:                    |
      | query:                                     |   data:                  |
      |   fields: status,roles.role                |     - status: invited    |
      |   filter[email][_eq]: to-<run>@example.com |       roles:             |
      |                                            |         - role: <role-b> |
      | method: GET                                | code: 200                |+
      | path: /users                               | body:                    |
      | query:                                     |   data:                  |
      |   fields: roles.role                       |     - roles:             |
      |   filter[email][_eq]: to-<run>@example.com |         - role: <role-b> |
      |   deep[roles][_filter][managed_by][_eq]:   |                          |
      |     invite:<inviter-a>                     |                          |
      | as: inviter-b-<run>                        | code: 204                |+
      | method: POST                               |                          |
      | path: /users/invite                        |                          |
      | payload:                                   |                          |
      |   email: to-<run>@example.com              |                          |
      |   roles:                                   |                          |
      |     - <role-a>                             |                          |
      | method: GET                                | code: 200                |+
      | path: /users                               | body:                    |
      | query:                                     |   data:                  |
      |   fields: roles.role                       |     - roles:             |
      |   filter[email][_eq]: to-<run>@example.com |         - role: <role-a> |
      |   deep[roles][_filter][managed_by][_eq]:   |                          |
      |     invite:<inviter-b>                     |                          |
      | method: GET                                | code: 200                |+
      | path: /users                               | body:                    |
      | query:                                     |   data:                  |
      |   fields: roles.role                       |     - roles:             |
      |   filter[email][_eq]: to-<run>@example.com |         - role: <role-b> |
      |   deep[roles][_filter][managed_by][_eq]:   |                          |
      |     invite:<inviter-a>                     |                          |

  Scenario: a role the user holds by hand is refused when given again by hand
    Given the rows of directus_roles:
      | id      | name        |
      | <staff> | staff-<run> |
    And the rows of directus_users:
      | id      | email                   |
      | <alice> | alice-<run>@example.com |
    And the rows of directus_role_members:
      | user    | role    | sort |
      | <alice> | <staff> | 1    |
    Then these requests get these responses:
      | request                           | response                        |
      | method: PATCH                     | code: 400                       |+
      | path: /users/<alice>              | body:                           |
      | payload:                          |   errors:                       |
      |   roles:                          |     - message: >-               |
      |     create:                       |         Invalid payload. The    |
      |       - role: <staff>             |         user "<alice>" already  |
      |                                   |         holds the role          |
      |                                   |         "<staff>" with          |
      |                                   |         managed_by null.        |
      |                                   |       extensions:               |
      |                                   |         code: INVALID_PAYLOAD   |
      | method: GET                       | code: 200                       |+
      | path: /users/<alice>              | body:                           |
      | query:                            |   data:                         |
      |   fields: roles.role,roles.sort   |     roles:                      |
      |                                   |       - role: <staff>           |
      |                                   |         sort: 1                 |
