Feature: An email is invited, invited again and accepts the invitation

  - The invitation mail is sent without being awaited, so a scenario reads
    the rows it writes, never the mail.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    token it mails.
  - A Given states the database rows a scenario starts from, written straight
    into the database. An invitation is the rows `/users/invite` writes: a
    `directus_invites` row per email, role and inviter, read through the
    graphql `invites` query; an `inviter` of null names no inviter. No user
    and no membership is written until the invitation is accepted: logged
    out, it creates the account of the email with the password sent; logged
    in, the roles go to that account. An invite token never sets the password
    of an existing account, which logs in first.
  - An inviter allowed to create the `directus_invites` rows invites, admin
    or not; one who is no admin gives no policy they don't hold, and no
    invite gives a role reaching admin access.
  - A request authenticates as the admin, unless it names the token it sends
    `as`, or sends none `as: public`. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own; met first in
    a response, it stands for the uuid received there. A response cell
    states the keys it checks.

  Scenario: an invited email takes the role of its latest invitation
    Given the rows of directus_roles:
      | id            | name         |
      | <first-role>  | first-<run>  |
      | <second-role> | second-<run> |
    Then these requests get these responses:
      | request                            | response                    |
      | method: POST                       | code: 204                   |+
      | path: /users/invite                |                             |
      | payload:                           |                             |
      |   email: invited-<run>@example.com |                             |
      |   roles:                           |                             |
      |     - <first-role>                 |                             |
      | method: POST                       | code: 200                   |+
      | path: /graphql/system              | body:                       |
      | payload:                           |   data:                     |
      |   query: >-                        |     invites:                |
      |     { invites(filter:              |       - role:               |
      |     {email: {_eq:                  |           id: <first-role>  |
      |     "invited-<run>@example.com"}}) |                             |
      |     { role { id } } }              |                             |
      | method: POST                       | code: 204                   |+
      | path: /users/invite                |                             |
      | payload:                           |                             |
      |   email: invited-<run>@example.com |                             |
      |   roles:                           |                             |
      |     - <second-role>                |                             |
      | method: POST                       | code: 200                   |+
      | path: /graphql/system              | body:                       |
      | payload:                           |   data:                     |
      |   query: >-                        |     invites:                |
      |     { invites(filter:              |       - role:               |
      |     {email: {_eq:                  |           id: <second-role> |
      |     "invited-<run>@example.com"}}) |                             |
      |     { role { id } } }              |                             |
      | method: GET                        | code: 200                   |+
      | path: /users                       | body:                       |
      | query:                             |   data: []                  |
      |   fields: id                       |                             |
      |   filter[email][_eq]: >-           |                             |
      |     invited-<run>@example.com      |                             |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_access  | 1      | 0      | 0      | 0      |
      | 1       | directus_invites | 1      | 1      | 0      | 0      |
      | 1       | directus_roles   | 1      | 0      | 0      | 0      |
      | 3       | directus_access  | 1      | 0      | 0      | 0      |
      | 3       | directus_invites | 1      | 1      | 0      | 1      |
      | 3       | directus_roles   | 1      | 0      | 0      | 0      |

  Scenario: an invitation accepted logged out creates the account of its email
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_invites:
      | id       | email                       | role           | inviter |
      | <invite> | accepting-<run>@example.com | <invitee-role> | null    |
    Then these requests get these responses:
      | request                                | response                       |
      | as: public                             | code: 204                      |+
      | method: POST                           |                                |
      | path: /users/invite/accept             |                                |
      | payload:                               |                                |
      |   token: !jwt                          |                                |
      |     email: accepting-<run>@example.com |                                |
      |     scope: invite                      |                                |
      |   password: accepted-password          |                                |
      | method: GET                            | code: 200                      |+
      | path: /users                           | body:                          |
      | query:                                 |   data:                        |
      |   fields: status,password,roles.role   |     - status: active           |
      |   filter[email][_eq]: >-               |       password: '**********'   |
      |     accepting-<run>@example.com        |       roles:                   |
      |                                        |         - role: <invitee-role> |
      | method: POST                           | code: 200                      |+
      | path: /graphql/system                  | body:                          |
      | payload:                               |   data:                        |
      |   query: >-                            |     invites: []                |
      |     { invites(filter:                  |                                |
      |     {email: {_eq:                      |                                |
      |     "accepting-<run>@example.com"}})   |                                |
      |     { role { id } } }                  |                                |
      | method: POST                           | code: 200                      |+
      | path: /auth/login                      |                                |
      | payload:                               |                                |
      |   email: accepting-<run>@example.com   |                                |
      |   password: accepted-password          |                                |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_invites      | 1      | 0      | 0      | 1      |
      | 1       | directus_role_members | 1      | 1      | 0      | 0      |
      | 1       | directus_users        | 2      | 1      | 0      | 0      |

  Scenario: an active user accepts logged in the roles an invitation proposes
    Given the rows of directus_roles:
      | id              | name           |
      | <proposed-role> | proposed-<run> |
    And the rows of directus_users:
      | id       | email                    | status | token        |
      | <member> | member-<run>@example.com | active | member-<run> |
    Then these requests get these responses:
      | request                              | response                        |
      | method: POST                         | code: 204                       |+
      | path: /users/invite                  |                                 |
      | payload:                             |                                 |
      |   email: member-<run>@example.com    |                                 |
      |   roles:                             |                                 |
      |     - <proposed-role>                |                                 |
      | method: GET                          | code: 200                       |+
      | path: /users                         | body:                           |
      | query:                               |   data:                         |
      |   fields: status,roles               |     - status: active            |
      |   filter[email][_eq]: >-             |       roles: []                 |
      |     member-<run>@example.com         |                                 |
      | as: member-<run>                     | code: 204                       |+
      | method: POST                         |                                 |
      | path: /users/invite/accept           |                                 |
      | payload:                             |                                 |
      |   token: !jwt                        |                                 |
      |     email: member-<run>@example.com  |                                 |
      |     scope: invite                    |                                 |
      | method: GET                          | code: 200                       |+
      | path: /users                         | body:                           |
      | query:                               |   data:                         |
      |   fields: status,password,roles.role |     - status: active            |
      |   filter[email][_eq]: >-             |       password: null            |
      |     member-<run>@example.com         |       roles:                    |
      |                                      |         - role: <proposed-role> |
      | method: POST                         | code: 200                       |+
      | path: /graphql/system                | body:                           |
      | payload:                             |   data:                         |
      |   query: >-                          |     invites: []                 |
      |     { invites(filter:                |                                 |
      |     {email: {_eq:                    |                                 |
      |     "member-<run>@example.com"}})    |                                 |
      |     { role { id } } }                |                                 |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_invites | 1      | 1      | 0      | 0      |
      | 3       | directus_invites | 1      | 0      | 0      | 1      |

  Scenario: an invitation of an account's email accepted logged out is refused
    Given the rows of directus_roles:
      | id              | name           |
      | <proposed-role> | proposed-<run> |
    And the rows of directus_users:
      | id      | email                   | status |
      | <owner> | owner-<run>@example.com | active |
    And the rows of directus_invites:
      | id       | email                   | role            | inviter |
      | <invite> | owner-<run>@example.com | <proposed-role> | null    |
    Then these requests get these responses:
      | request                            | response                                   |
      | as: public                         | code: 400                                  |+
      | method: POST                       | body:                                      |
      | path: /users/invite/accept         |   errors:                                  |
      | payload:                           |     - message: >-                          |
      |   token: !jwt                      |         Invalid payload. Email address     |
      |     email: owner-<run>@example.com |         "owner-<run>@example.com" has an   |
      |     scope: invite                  |         account: log in to it, then accept |
      |   password: taken-password         |         the invite.                        |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data:                                    |
      |   fields: password,roles           |     - password: null                       |
      |   filter[email][_eq]: >-           |       roles: []                            |
      |     owner-<run>@example.com        |                                            |
      | method: POST                       | code: 200                                  |+
      | path: /graphql/system              | body:                                      |
      | payload:                           |   data:                                    |
      |   query: >-                        |     invites:                               |
      |     { invites(filter:              |       - role:                              |
      |     {email: {_eq:                  |           id: <proposed-role>              |
      |     "owner-<run>@example.com"}})   |                                            |
      |     { role { id } } }              |                                            |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_invites | 1      | 0      | 0      | 0      |
      | 1       | directus_users   | 1      | 0      | 0      | 0      |

  Scenario: an invitation accepted logged in with a password is refused
    Given the rows of directus_roles:
      | id             | name          |
      | <invitee-role> | invitee-<run> |
    And the rows of directus_invites:
      | id       | email                   | role           | inviter |
      | <invite> | other-<run>@example.com | <invitee-role> | null    |
    Then these requests get these responses:
      | request                            | response                                   |
      | method: POST                       | code: 400                                  |+
      | path: /users/invite/accept         | body:                                      |
      | payload:                           |   errors:                                  |
      |   token: !jwt                      |     - message: >-                          |
      |     email: other-<run>@example.com |         Invalid payload. A password        |
      |     scope: invite                  |         creates a new account: log out to  |
      |   password: new-password           |         create the account of              |
      |                                    |         "other-<run>@example.com", or send |
      |                                    |         no password to add the invited     |
      |                                    |         roles to your account.             |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data: []                                 |
      |   fields: id                       |                                            |
      |   filter[email][_eq]: >-           |                                            |
      |     other-<run>@example.com        |                                            |

  Scenario: an invitation token is refused for another scope or an email not invited
    Given the rows of directus_users:
      | id       | email                    |
      | <active> | active-<run>@example.com |
    Then these requests get these responses:
      | request                             | response                                |
      | as: public                          | code: 403                               |+
      | method: POST                        | body:                                   |
      | path: /users/invite/accept          |   errors:                               |
      | payload:                            |     - message: Not an invite token      |
      |   token: !jwt                       |                                         |
      |     email: active-<run>@example.com |                                         |
      |     scope: password-reset           |                                         |
      |   password: accepted-password       |                                         |
      | as: public                          | code: 400                               |+
      | method: POST                        | body:                                   |
      | path: /users/invite/accept          |   errors:                               |
      | payload:                            |     - message: >-                       |
      |   token: !jwt                       |         Invalid payload. Email address  |
      |     email: active-<run>@example.com |         active-<run>@example.com hasn't |
      |     scope: invite                   |         been invited.                   |
      |   password: accepted-password       |                                         |
      | method: GET                         | code: 200                               |+
      | path: /users                        | body:                                   |
      | query:                              |   data:                                 |
      |   fields: status,password           |     - status: active                    |
      |   filter[email][_eq]: >-            |       password: null                    |
      |     active-<run>@example.com        |                                         |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | (none)           | 0      | 0      | 0      | 0      |
      | 2       | directus_invites | 1      | 0      | 0      | 0      |

  Scenario: an invitation to a URL off the allow list writes no invite
    Given the rows of directus_roles:
      | id             | name          |
      | <refused-role> | refused-<run> |
    And the rows of directus_users:
      | id      | email                   | status |
      | <known> | known-<run>@example.com | active |
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
      | method: POST                       | code: 400                               |+
      | path: /users/invite                | body:                                   |
      | payload:                           |   errors:                               |
      |   email: known-<run>@example.com   |     - message: >-                       |
      |   roles:                           |         Invalid payload. URL            |
      |     - <refused-role>               |         "https://elsewhere.test/accept" |
      |   invite_url: >-                   |         can't be used to invite users.  |
      |     https://elsewhere.test/accept  |                                         |
      | method: POST                       | code: 200                               |+
      | path: /graphql/system              | body:                                   |
      | payload:                           |   data:                                 |
      |   query: >-                        |     invites: []                         |
      |     { invites(filter:              |                                         |
      |     {email: {_eq:                  |                                         |
      |     "refused-<run>@example.com"}}) |                                         |
      |     { role { id } } }              |                                         |
      | method: POST                       | code: 200                               |+
      | path: /graphql/system              | body:                                   |
      | payload:                           |   data:                                 |
      |   query: >-                        |     invites: []                         |
      |     { invites(filter:              |                                         |
      |     {email: {_eq:                  |                                         |
      |     "known-<run>@example.com"}})   |                                         |
      |     { role { id } } }              |                                         |
    And on postgres the requests ran these statements:
      | request | table           | select | insert | update | delete |
      | 1       | directus_access | 1      | 0      | 0      | 0      |
      | 1       | directus_roles  | 1      | 0      | 0      | 0      |
      | 2       | directus_access | 1      | 0      | 0      | 0      |
      | 2       | directus_roles  | 1      | 0      | 0      | 0      |

  Scenario: graphql invites an email into the one role it names
    Given the rows of directus_roles:
      | id             | name          |
      | <graphql-role> | graphql-<run> |
    Then these requests get these responses:
      | request                                 | response                     |
      | method: POST                            | code: 200                    |+
      | path: /graphql/system                   | body:                        |
      | payload:                                |   data:                      |
      |   query: >-                             |     users_invite: true       |
      |     mutation { users_invite(            |                              |
      |     email: "graphql-<run>@example.com", |                              |
      |     roles: ["<graphql-role>"]) }        |                              |
      | method: POST                            | code: 200                    |+
      | path: /graphql/system                   | body:                        |
      | payload:                                |   data:                      |
      |   query: >-                             |     invites:                 |
      |     { invites(filter:                   |       - role:                |
      |     {email: {_eq:                       |           id: <graphql-role> |
      |     "graphql-<run>@example.com"}})      |                              |
      |     { role { id } } }                   |                              |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_access  | 1      | 0      | 0      | 0      |
      | 1       | directus_invites | 1      | 1      | 0      | 0      |
      | 1       | directus_roles   | 1      | 0      | 0      | 0      |

  Scenario: an email invited again into the same role keeps its invitation
    Given the rows of directus_policies:
      | id               | name          | app_access | admin_access |
      | <inviter-policy> | inviter-<run> | true       | true         |
    And the rows of directus_roles:
      | id          | name       |
      | <same-role> | same-<run> |
    And the rows of directus_users:
      | id        | email                     | status | token         |
      | <inviter> | inviter-<run>@example.com | active | inviter-<run> |
    And the rows of directus_access:
      | id               | user      | policy           |
      | <inviter-access> | <inviter> | <inviter-policy> |
    And the rows of directus_invites:
      | id       | email                  | role        | inviter   |
      | <invite> | same-<run>@example.com | <same-role> | <inviter> |
    Then these requests get these responses:
      | request                         | response                  |
      | as: inviter-<run>               | code: 204                 |+
      | method: POST                    |                           |
      | path: /users/invite             |                           |
      | payload:                        |                           |
      |   email: same-<run>@example.com |                           |
      |   roles:                        |                           |
      |     - <same-role>               |                           |
      | method: POST                    | code: 200                 |+
      | path: /graphql/system           | body:                     |
      | payload:                        |   data:                   |
      |   query: >-                     |     invites:              |
      |     { invites(filter:           |       - id: <invite>      |
      |     {email: {_eq:               |         role:             |
      |     "same-<run>@example.com"}}) |           id: <same-role> |
      |     { id role { id } } }        |                           |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 3      | 0      | 0      | 0      |
      | 1       | directus_invites      | 1      | 0      | 0      | 0      |
      | 1       | directus_role_members | 1      | 0      | 0      | 0      |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      |
      | 1       | directus_users        | 2      | 0      | 0      | 0      |

  Scenario: an email invited again by another inviter keeps both invitations
    Given the rows of directus_roles:
      | id          | name        |
      | <same-role> | again-<run> |
    And the rows of directus_invites:
      | id       | email                   | role        | inviter | date_created |
      | <invite> | again-<run>@example.com | <same-role> | null    | 2026-01-01   |
    Then these requests get these responses:
      | request                              | response                               |
      | method: POST                         | code: 204                              |+
      | path: /users/invite                  |                                        |
      | payload:                             |                                        |
      |   email: Again-<run>@example.com     |                                        |
      |   roles:                             |                                        |
      |     - <same-role>                    |                                        |
      | method: POST                         | code: 200                              |+
      | path: /graphql/system                | body:                                  |
      | payload:                             |   data:                                |
      |   query: >-                          |     invites:                           |
      |     { invites(filter: {role:         |       - id: <invite>                   |
      |     {id: {_eq: "<same-role>"}}},     |         email: again-<run>@example.com |
      |     sort: ["date_created"])          |         inviter: null                  |
      |     { id email inviter { email } } } |       - id: <new-invite>               |
      |                                      |         email: Again-<run>@example.com |
      |                                      |         inviter:                       |
      |                                      |           email: admin@default.com     |
    And on postgres the requests ran these statements:
      | request | table            | select | insert | update | delete |
      | 1       | directus_access  | 1      | 0      | 0      | 0      |
      | 1       | directus_invites | 1      | 1      | 0      | 0      |
      | 1       | directus_roles   | 1      | 0      | 0      | 0      |
      | 2       | directus_invites | 1      | 0      | 0      | 0      |
      | 2       | directus_roles   | 1      | 0      | 0      | 0      |
      | 2       | directus_users   | 2      | 0      | 0      | 0      |

  Scenario: an invitation to a role reaching admin access is refused
    Given the rows of directus_policies:
      | id             | name        | app_access | admin_access |
      | <admin-policy> | admin-<run> | true       | true         |
    And the rows of directus_roles:
      | id           | name        | parent       |
      | <admin-role> | admin-<run> | null         |
      | <child-role> | child-<run> | <admin-role> |
      | <plain-role> | plain-<run> | null         |
    And the rows of directus_access:
      | id       | role         | policy         |
      | <access> | <admin-role> | <admin-policy> |
    Then these requests get these responses:
      | request                          | response                                   |
      | method: POST                     | code: 400                                  |+
      | path: /users/invite              | body:                                      |
      | payload:                         |   errors:                                  |
      |   email: child-<run>@example.com |     - message: >-                          |
      |   roles:                         |         Invalid payload. Role              |
      |     - <plain-role>               |         "<child-role>" gives admin access, |
      |     - <child-role>               |         which an invite can't give: add    |
      |                                  |         the membership once the user       |
      |                                  |         accepted.                          |
      | method: POST                     | code: 200                                  |+
      | path: /graphql/system            | body:                                      |
      | payload:                         |   data:                                    |
      |   query: >-                      |     invites: []                            |
      |     { invites(filter:            |                                            |
      |     {email: {_eq:                |                                            |
      |     "child-<run>@example.com"}}) |                                            |
      |     { role { id } } }            |                                            |

  Scenario: a user who is no admin invites with their invite permission
    Given the rows of directus_policies:
      | id          | name          | app_access | admin_access |
      | <p-inviter> | inviter-<run> | true       | false        |
    And the rows of directus_permissions:
      | policy      | collection       | action | fields |
      | <p-inviter> | directus_users   | create | *      |
      | <p-inviter> | directus_invites | create | *      |
    And the rows of directus_roles:
      | id          | name       |
      | <some-role> | some-<run> |
    And the rows of directus_users:
      | id        | email                     | token         |
      | <inviter> | inviter-<run>@example.com | inviter-<run> |
    And the rows of directus_access:
      | id            | user      | role        | policy      |
      | <access>      | <inviter> | null        | <p-inviter> |
      | <role-access> | null      | <some-role> | <p-inviter> |
    Then these requests get these responses:
      | request                              | response                  |
      | as: inviter-<run>                    | code: 204                 |+
      | method: POST                         |                           |
      | path: /users/invite                  |                           |
      | payload:                             |                           |
      |   email: invited-<run>@example.com   |                           |
      |   roles:                             |                           |
      |     - <some-role>                    |                           |
      | method: POST                         | code: 200                 |+
      | path: /graphql/system                | body:                     |
      | payload:                             |   data:                   |
      |   query: >-                          |     invites:              |
      |     { invites(filter:                |       - role:             |
      |     {email: {_eq:                    |           id: <some-role> |
      |     "invited-<run>@example.com"}})   |         inviter:          |
      |     { role { id } inviter { id } } } |           id: <inviter>   |

  Scenario: a user who is no admin is refused a role granting a policy they don't hold
    Given the rows of directus_policies:
      | id          | name          | app_access | admin_access |
      | <p-inviter> | inviter-<run> | true       | false        |
      | <p-other>   | other-<run>   | true       | false        |
    And the rows of directus_permissions:
      | policy      | collection       | action | fields |
      | <p-inviter> | directus_users   | create | *      |
      | <p-inviter> | directus_invites | create | *      |
    And the rows of directus_roles:
      | id          | name       |
      | <some-role> | some-<run> |
    And the rows of directus_users:
      | id        | email                     | token         |
      | <inviter> | inviter-<run>@example.com | inviter-<run> |
    And the rows of directus_access:
      | id            | user      | role        | policy      |
      | <access>      | <inviter> | null        | <p-inviter> |
      | <role-access> | null      | <some-role> | <p-other>   |
    Then these requests get these responses:
      | request                           | response                                  |
      | as: inviter-<run>                 | code: 400                                 |+
      | method: POST                      | body:                                     |
      | path: /users/invite               |   errors:                                 |
      | payload:                          |     - message: >-                         |
      |   email: unheld-<run>@example.com |         Invalid payload. You can't invite |
      |   roles:                          |         into role "some-<run>": it grants |
      |     - <some-role>                 |         policy "other-<run>" you don't    |
      |                                   |         hold.                             |
      | method: POST                      | code: 200                                 |+
      | path: /graphql/system             | body:                                     |
      | payload:                          |   data:                                   |
      |   query: >-                       |     invites: []                           |
      |     { invites(filter:             |                                           |
      |     {email: {_eq:                 |                                           |
      |     "unheld-<run>@example.com"}}) |                                           |
      |     { role { id } } }             |                                           |

  Scenario: an invitation from a user not allowed to create its invite is refused
    Given the rows of directus_policies:
      | id          | name          | app_access | admin_access |
      | <p-inviter> | inviter-<run> | true       | false        |
    And the rows of directus_permissions:
      | policy      | collection     | action | fields |
      | <p-inviter> | directus_users | create | *      |
    And the rows of directus_roles:
      | id          | name       |
      | <some-role> | some-<run> |
    And the rows of directus_users:
      | id        | email                     | token         |
      | <inviter> | inviter-<run>@example.com | inviter-<run> |
    And the rows of directus_access:
      | id       | user      | role | policy      |
      | <access> | <inviter> | null | <p-inviter> |
    Then these requests get these responses:
      | request                           | response                                  |
      | as: inviter-<run>                 | code: 403                                 |+
      | method: POST                      | body:                                     |
      | path: /users/invite               |   errors:                                 |
      | payload:                          |     - message: >-                         |
      |   email: denied-<run>@example.com |         You don't have permission to      |
      |   roles:                          |         "create" from collection          |
      |     - <some-role>                 |         "directus_invites" or it does not |
      |                                   |         exist.                            |
      | method: POST                      | code: 200                                 |+
      | path: /graphql/system             | body:                                     |
      | payload:                          |   data:                                   |
      |   query: >-                       |     invites: []                           |
      |     { invites(filter:             |                                           |
      |     {email: {_eq:                 |                                           |
      |     "denied-<run>@example.com"}}) |                                           |
      |     { role { id } } }             |                                           |
