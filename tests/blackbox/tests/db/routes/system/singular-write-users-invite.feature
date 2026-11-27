Feature: A user is invited, re-invited and accepts the invitation

  - The invitation mail is sent without being awaited, so a scenario reads
    the user it writes, never the mail.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    token it mails.
  - A Given states the database rows a scenario starts from, written straight
    into the database. An invited user is the row `/users/invite` writes: a
    `directus_users` row with the `invited` status and its role.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: an invited user takes the role of their latest invitation
    Given the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    Then these requests get these responses:
      | request                              | response                  |
      | method: POST                         | code: 204                 |+
      | path: /users/invite                  |                           |
      | payload:                             |                           |
      |   email: invited-<run>@example.com   |                           |
      |   role: <first-role>                 |                           |
      | method: GET                          | code: 200                 |+
      | path: /users                         | body:                     |
      | query:                               |   data:                   |
      |   fields: status,role                |     - status: invited     |
      |   filter[identities][value][_eq]: >- |       role: <first-role>  |
      |     invited-<run>@example.com        |                           |
      | method: POST                         | code: 204                 |+
      | path: /users/invite                  |                           |
      | payload:                             |                           |
      |   email: invited-<run>@example.com   |                           |
      |   role: <second-role>                |                           |
      | method: GET                          | code: 200                 |+
      | path: /users                         | body:                     |
      | query:                               |   data:                   |
      |   fields: status,role                |     - status: invited     |
      |   filter[identities][value][_eq]: >- |       role: <second-role> |
      |     invited-<run>@example.com        |                           |
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_activity  | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions | 0      | 1      | 0      | 0      |
      | 1       | directus_users     | 3      | 1      | 0      | 0      |
      | 3       | directus_access    | 2      | 0      | 0      | 0      |
      | 3       | directus_activity  | 0      | 1      | 0      | 0      |
      | 3       | directus_revisions | 0      | 1      | 0      | 0      |
      | 3       | directus_roles     | 1      | 0      | 0      | 0      |
      | 3       | directus_users     | 4      | 0      | 1      | 0      |

  Scenario: an invitation accepted with its token activates the user
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_users:
      | id          | role           | status  |
      | <accepting> | <invitee-role> | invited |
    And the rows of directus_user_identities:
      | id                | user        | kind  | value                       |
      | <accepting-email> | <accepting> | email | accepting-<run>@example.com |
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
      |   filter[identities][value][_eq]: >-   |       password: '**********' |
      |     accepting-<run>@example.com        |                              |
      | method: POST                           | code: 200                    |+
      | path: /auth/login                      |                              |
      | payload:                               |                              |
      |   email: accepting-<run>@example.com   |                              |
      |   password: accepted-password          |                              |
    And on postgres the requests ran these statements:
      | request | table             | select | insert | update | delete |
      | 1       | directus_sessions | 0      | 0      | 0      | 1      |
      | 1       | directus_settings | 1      | 0      | 0      | 0      |
      | 1       | directus_users    | 2      | 0      | 1      | 0      |
      | 3       | directus_access   | 2      | 0      | 0      | 0      |
      | 3       | directus_activity | 0      | 1      | 0      | 0      |
      | 3       | directus_roles    | 1      | 0      | 0      | 0      |
      | 3       | directus_sessions | 0      | 1      | 0      | 1      |
      | 3       | directus_settings | 1      | 0      | 0      | 0      |
      | 3       | directus_users    | 3      | 0      | 1      | 0      |

  Scenario: an invitation token is refused for another scope or a user not invited
    Given the rows of directus_users:
      | id       |
      | <active> |
    And the rows of directus_user_identities:
      | id             | user     | kind  | value                    |
      | <active-email> | <active> | email | active-<run>@example.com |
    Then these requests get these responses:
      | request                              | response                                |
      | method: POST                         | code: 403                               |+
      | path: /users/invite/accept           | body:                                   |
      | payload:                             |   errors:                               |
      |   token: !jwt                        |     - message: Not an invite token      |
      |     email: active-<run>@example.com  |                                         |
      |     scope: password-reset            |                                         |
      |   password: accepted-password        |                                         |
      | method: POST                         | code: 400                               |+
      | path: /users/invite/accept           | body:                                   |
      | payload:                             |   errors:                               |
      |   token: !jwt                        |     - message: >-                       |
      |     email: active-<run>@example.com  |         Invalid payload. Email address  |
      |     scope: invite                    |         active-<run>@example.com hasn't |
      |   password: accepted-password        |         been invited.                   |
      | method: GET                          | code: 200                               |+
      | path: /users                         | body:                                   |
      | query:                               |   data:                                 |
      |   fields: status,password            |     - status: active                    |
      |   filter[identities][value][_eq]: >- |       password: null                    |
      |     active-<run>@example.com         |                                         |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 1      | 0      | 0      | 0      |
      | 2       | directus_users | 2      | 0      | 0      | 0      |

  Scenario: an invitation to a URL off the allow list creates no user
    Given the rows of directus_roles:
      | id             | name          |
      | <refused-role> | refused-<run> |
    Then these requests get these responses:
      | request                              | response                                |
      | method: POST                         | code: 400                               |+
      | path: /users/invite                  | body:                                   |
      | payload:                             |   errors:                               |
      |   email: refused-<run>@example.com   |     - message: >-                       |
      |   role: <refused-role>               |         Invalid payload. URL            |
      |   invite_url: >-                     |         "https://elsewhere.test/accept" |
      |     https://elsewhere.test/accept    |         can't be used to invite users.  |
      | method: GET                          | code: 200                               |+
      | path: /users                         | body:                                   |
      | query:                               |   data: []                              |
      |   fields: id                         |                                         |
      |   filter[identities][value][_eq]: >- |                                         |
      |     refused-<run>@example.com        |                                         |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 3      | 0      | 0      | 0      |

  Scenario: a user invited again to a URL off the allow list is refused
    Given the rows of directus_roles:
      | id           | name        |
      | <again-role> | again-<run> |
    And the rows of directus_users:
      | id      | role         | status  |
      | <again> | <again-role> | invited |
      | <known> | null         | active  |
    And the rows of directus_user_identities:
      | id            | user    | kind  | value                   |
      | <again-email> | <again> | email | again-<run>@example.com |
      | <known-email> | <known> | email | known-<run>@example.com |
    Then these requests get these responses:
      | request                           | response                                |
      | method: POST                      | code: 400                               |+
      | path: /users/invite               | body:                                   |
      | payload:                          |   errors:                               |
      |   email: again-<run>@example.com  |     - message: >-                       |
      |   role: <again-role>              |         Invalid payload. URL            |
      |   invite_url: >-                  |         "https://elsewhere.test/accept" |
      |     https://elsewhere.test/accept |         can't be used to invite users.  |
      | method: POST                      | code: 400                               |+
      | path: /users/invite               | body:                                   |
      | payload:                          |   errors:                               |
      |   email: known-<run>@example.com  |     - message: >-                       |
      |   role: <again-role>              |         Invalid payload. URL            |
      |   invite_url: >-                  |         "https://elsewhere.test/accept" |
      |     https://elsewhere.test/accept |         can't be used to invite users.  |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 2      | 0      | 0      | 0      |
      | 2       | directus_users | 2      | 0      | 0      | 0      |

  Scenario: graphql invites a user into the one role it names
    Given the rows of directus_roles:
      | id             | name          |
      | <graphql-role> | graphql-<run> |
    Then these requests get these responses:
      | request                                 | response                   |
      | method: POST                            | code: 200                  |+
      | path: /graphql/system                   | body:                      |
      | payload:                                |   data:                    |
      |   query: >-                             |     users_invite: true     |
      |     mutation { users_invite(            |                            |
      |     email: "graphql-<run>@example.com", |                            |
      |     role: "<graphql-role>") }           |                            |
      | method: GET                             | code: 200                  |+
      | path: /users                            | body:                      |
      | query:                                  |   data:                    |
      |   fields: status,role                   |     - status: invited      |
      |   filter[identities][value][_eq]: >-    |       role: <graphql-role> |
      |     graphql-<run>@example.com           |                            |
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_activity  | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions | 0      | 1      | 0      | 0      |
      | 1       | directus_users     | 3      | 1      | 0      | 0      |

  Scenario: a user invited again into the same role keeps their invitation
    Given the rows of directus_roles:
      | id          | name       |
      | <same-role> | same-<run> |
    And the rows of directus_users:
      | id          | role        | status  |
      | <same-user> | <same-role> | invited |
    And the rows of directus_user_identities:
      | id                | user        | kind  | value                  |
      | <same-user-email> | <same-user> | email | same-<run>@example.com |
    Then these requests get these responses:
      | request                              | response                |
      | method: POST                         | code: 204               |+
      | path: /users/invite                  |                         |
      | payload:                             |                         |
      |   email: same-<run>@example.com      |                         |
      |   role: <same-role>                  |                         |
      | method: GET                          | code: 200               |+
      | path: /users                         | body:                   |
      | query:                               |   data:                 |
      |   fields: status,role                |     - status: invited   |
      |   filter[identities][value][_eq]: >- |       role: <same-role> |
      |     same-<run>@example.com           |                         |
    And on postgres the requests ran these statements:
      | request | table          | select | insert | update | delete |
      | 1       | directus_users | 2      | 0      | 0      | 0      |
