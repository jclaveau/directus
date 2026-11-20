Feature: A user is invited, re-invited and accepts the invitation

  - The invitation mail is sent without being awaited, so a scenario reads
    the user it writes, never the mail.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    token it mails.
  - A Given states the database rows a scenario starts from, written straight
    into the database. An invited user is the rows `/users/invite` writes: a
    `directus_users` row with the `invited` status, a `directus_role_members`
    row per role, `managed_by: invite`, and the `directus_invites` row of
    each; a `user_created` of null names no inviter.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: an invited user takes the role of their latest invitation
    Given the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    Then these requests get these responses:
      | request                            | response                      |
      | method: POST                       | code: 204                     |+
      | path: /users/invite                |                               |
      | payload:                           |                               |
      |   email: invited-<run>@example.com |                               |
      |   roles:                           |                               |
      |     - <first-role>                 |                               |
      | method: GET                        | code: 200                     |+
      | path: /users                       | body:                         |
      | query:                             |   data:                       |
      |   fields: status,roles.role        |     - status: invited         |
      |   filter[email][_eq]: >-           |       roles:                  |
      |     invited-<run>@example.com      |         - role: <first-role>  |
      | method: POST                       | code: 204                     |+
      | path: /users/invite                |                               |
      | payload:                           |                               |
      |   email: invited-<run>@example.com |                               |
      |   roles:                           |                               |
      |     - <second-role>                |                               |
      | method: GET                        | code: 200                     |+
      | path: /users                       | body:                         |
      | query:                             |   data:                       |
      |   fields: status,roles.role        |     - status: invited         |
      |   filter[email][_eq]: >-           |       roles:                  |
      |     invited-<run>@example.com      |         - role: <second-role> |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_invites      | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 0      | 1      | 0      | 0      |
      | 1       | directus_users        | 3      | 1      | 0      | 0      |
      | 3       | directus_access       | 1      | 0      | 0      | 0      |
      | 3       | directus_invites      | 1      | 1      | 0      | 1      |
      | 3       | directus_role_members | 1      | 1      | 0      | 1      |
      | 3       | directus_roles        | 1      | 0      | 0      | 0      |
      | 3       | directus_users        | 3      | 0      | 0      | 0      |

  Scenario: an invitation accepted with its token activates the user
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id          | email                       | status  |
      | <accepting> | accepting-<run>@example.com | invited |
    And the rows of directus_role_members:
      | id           | user        | role           | sort | managed_by |
      | <membership> | <accepting> | <invitee-role> | 1    | invite     |
    And the rows of directus_invites:
      | id       | user        | role           | user_created |
      | <invite> | <accepting> | <invitee-role> | null         |
    Then these requests get these responses:
      | request                                | response                     |
      | method: POST                           | code: 204                    |+
      | path: /users/invite/accept             |                              |
      | payload:                               |                              |
      |   token: !jwt                          |                              |
      |     email: accepting-<run>@example.com |                              |
      |     scope: invite                      |                              |
      |   password: accepted-password          |                              |
      | method: GET                            | code: 200                    |+
      | path: /users                           | body:                        |
      | query:                                 |   data:                      |
      |   fields: status,password              |     - status: active         |
      |   filter[email][_eq]: >-               |       password: '**********' |
      |     accepting-<run>@example.com        |                              |
      | method: POST                           | code: 200                    |+
      | path: /auth/login                      |                              |
      | payload:                               |                              |
      |   email: accepting-<run>@example.com   |                              |
      |   password: accepted-password          |                              |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_role_members | 0      | 0      | 0      | 0      | 1    |
      | 1       | directus_sessions     | 0      | 0      | 0      | 1      | 0    |
      | 1       | directus_settings     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 2      | 0      | 1      | 0      | 0    |
      | 3       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_role_members | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_sessions     | 0      | 1      | 0      | 1      | 0    |
      | 3       | directus_settings     | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_users        | 3      | 0      | 1      | 0      | 0    |

  Scenario: an invitation token is refused for another scope or a user not invited
    Given the rows of directus_users:
      | id       | email                    |
      | <active> | active-<run>@example.com |
    Then these requests get these responses:
      | request                             | response                                |
      | method: POST                        | code: 403                               |+
      | path: /users/invite/accept          | body:                                   |
      | payload:                            |   errors:                               |
      |   token: !jwt                       |     - message: Not an invite token      |
      |     email: active-<run>@example.com |                                         |
      |     scope: password-reset           |                                         |
      |   password: accepted-password       |                                         |
      | method: POST                        | code: 400                               |+
      | path: /users/invite/accept          | body:                                   |
      | payload:                            |   errors:                               |
      |   token: !jwt                       |     - message: >-                       |
      |     email: active-<run>@example.com |         Invalid payload. Email address  |
      |     scope: invite                   |         active-<run>@example.com hasn't |
      |   password: accepted-password       |         been invited.                   |
      | method: GET                         | code: 200                               |+
      | path: /users                        | body:                                   |
      | query:                              |   data:                                 |
      |   fields: status,password           |     - status: active                    |
      |   filter[email][_eq]: >-            |       password: null                    |
      |     active-<run>@example.com        |                                         |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 1      | 0      | 0      | 0      |
      | 2       | directus_users | 2      | 0      | 0      | 0      |

  Scenario: an invitation to a URL off the allow list creates no user
    Given the rows of directus_roles:
      | id             | name          |
      | <refused-role> | refused-<run> |
    Then these requests get these responses:
      | request                            | response                                |
      | method: POST                       | code: 400                               |+
      | path: /users/invite                | body:                                   |
      | payload:                           |   errors:                               |
      |   email: refused-<run>@example.com |     - message: >-                       |
      |   roles:                           |         Invalid payload. URL            |
      |     - <refused-role>               |         "https://elsewhere.test/accept" |
      |   invite_url: >-                   |         can't be used to invite users.  |
      |     https://elsewhere.test/accept  |                                         |
      | method: GET                        | code: 200                               |+
      | path: /users                       | body:                                   |
      | query:                             |   data: []                              |
      |   fields: id                       |                                         |
      |   filter[email][_eq]: >-           |                                         |
      |     refused-<run>@example.com      |                                         |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 3      | 0      | 0      | 0      |

  Scenario: a user invited again to a URL off the allow list is refused
    Given the rows of directus_roles:
      | id           | name        |
      | <again-role> | again-<run> |
    And the rows of directus_users:
      | id      | email                   | status  |
      | <again> | again-<run>@example.com | invited |
      | <known> | known-<run>@example.com | active  |
    And the rows of directus_role_members:
      | id           | user    | role         | sort | managed_by |
      | <membership> | <again> | <again-role> | 1    | invite     |
    And the rows of directus_invites:
      | id       | user    | role         | user_created |
      | <invite> | <again> | <again-role> | null         |
    Then these requests get these responses:
      | request                           | response                                |
      | method: POST                      | code: 400                               |+
      | path: /users/invite               | body:                                   |
      | payload:                          |   errors:                               |
      |   email: again-<run>@example.com  |     - message: >-                       |
      |   roles:                          |         Invalid payload. URL            |
      |     - <again-role>                |         "https://elsewhere.test/accept" |
      |   invite_url: >-                  |         can't be used to invite users.  |
      |     https://elsewhere.test/accept |                                         |
      | method: POST                      | code: 400                               |+
      | path: /users/invite               | body:                                   |
      | payload:                          |   errors:                               |
      |   email: known-<run>@example.com  |     - message: >-                       |
      |   roles:                          |         Invalid payload. URL            |
      |     - <again-role>                |         "https://elsewhere.test/accept" |
      |   invite_url: >-                  |         can't be used to invite users.  |
      |     https://elsewhere.test/accept |                                         |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 2      | 0      | 0      | 0      |
      | 2       | directus_users        | 2      | 0      | 0      | 0      |

  Scenario: graphql invites a user into the one role it names
    Given the rows of directus_roles:
      | id             | name          |
      | <graphql-role> | graphql-<run> |
    Then these requests get these responses:
      | request                                 | response                       |
      | method: POST                            | code: 200                      |+
      | path: /graphql/system                   | body:                          |
      | payload:                                |   data:                        |
      |   query: >-                             |     users_invite: true         |
      |     mutation { users_invite(            |                                |
      |     email: "graphql-<run>@example.com", |                                |
      |     roles: ["<graphql-role>"]) }        |                                |
      | method: GET                             | code: 200                      |+
      | path: /users                            | body:                          |
      | query:                                  |   data:                        |
      |   fields: status,roles.role             |     - status: invited          |
      |   filter[email][_eq]: >-                |       roles:                   |
      |     graphql-<run>@example.com           |         - role: <graphql-role> |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      |
      | 1       | directus_invites      | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 0      | 1      | 0      | 0      |
      | 1       | directus_users        | 3      | 1      | 0      | 0      |

  Scenario: a user invited again into the same role keeps their invitation
    Given the rows of directus_policies:
      | id               | name          | app_access | admin_access |
      | <inviter-policy> | inviter-<run> | true       | true         |
    And the rows of directus_roles:
      | id          | name       |
      | <same-role> | same-<run> |
    And the rows of directus_users:
      | id          | email                     | status  | token         |
      | <inviter>   | inviter-<run>@example.com | active  | inviter-<run> |
      | <same-user> | same-<run>@example.com    | invited | null          |
    And the rows of directus_access:
      | id               | user      | policy           |
      | <inviter-access> | <inviter> | <inviter-policy> |
    And the rows of directus_role_members:
      | id           | user        | role        | sort | managed_by |
      | <membership> | <same-user> | <same-role> | 1    | invite     |
    And the rows of directus_invites:
      | id       | user        | role        | user_created |
      | <invite> | <same-user> | <same-role> | <inviter>    |
    Then these requests get these responses:
      | request                         | response                    |
      | as: inviter-<run>               | code: 204                   |+
      | method: POST                    |                             |
      | path: /users/invite             |                             |
      | payload:                        |                             |
      |   email: same-<run>@example.com |                             |
      |   roles:                        |                             |
      |     - <same-role>               |                             |
      | method: GET                     | code: 200                   |+
      | path: /users                    | body:                       |
      | query:                          |   data:                     |
      |   fields: status,roles.role     |     - status: invited       |
      |   filter[email][_eq]: >-        |       roles:                |
      |     same-<run>@example.com      |         - role: <same-role> |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 2      | 0      | 0      | 0      |
      | 1       | directus_invites      | 1      | 0      | 0      | 0      |
      | 1       | directus_role_members | 2      | 0      | 0      | 0      |
      | 1       | directus_users        | 2      | 0      | 0      | 0      |

  Scenario: a user invited again by another inviter keeps both invitations
    Given the rows of directus_roles:
      | id          | name        |
      | <same-role> | again-<run> |
    And the rows of directus_users:
      | id          | email                   | status  |
      | <same-user> | again-<run>@example.com | invited |
    And the rows of directus_role_members:
      | id           | user        | role        | sort | managed_by |
      | <membership> | <same-user> | <same-role> | 1    | invite     |
    And the rows of directus_invites:
      | id       | user        | role        | user_created | date_created         |
      | <invite> | <same-user> | <same-role> | null         | 2026-01-01T00:00:00Z |
    Then these requests get these responses:
      | request                              | response                           |
      | method: POST                         | code: 204                          |+
      | path: /users/invite                  |                                    |
      | payload:                             |                                    |
      |   email: again-<run>@example.com     |                                    |
      |   roles:                             |                                    |
      |     - <same-role>                    |                                    |
      | method: POST                         | code: 200                          |+
      | path: /graphql/system                | body:                              |
      | payload:                             |   data:                            |
      |   query: >-                          |     invites:                       |
      |     { invites(                       |       - id: <invite>               |
      |     filter: {user: {id: {_eq:        |         role:                      |
      |     "<same-user>"}}},                |           id: <same-role>          |
      |     sort: ["date_created"])          |         user_created: null         |
      |     { id role { id }                 |       - role:                      |
      |     user_created { email } } }       |           id: <same-role>          |
      |                                      |         user_created:              |
      |                                      |           email: admin@default.com |
      | method: GET                          | code: 200                          |+
      | path: /users                         | body:                              |
      | query:                               |   data:                            |
      |   fields: status,roles.role          |     - status: invited              |
      |   filter[email][_eq]: >-             |       roles:                       |
      |     again-<run>@example.com          |         - role: <same-role>        |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 3       | directus_users        | 1      | 0      | 0      | 0      |
