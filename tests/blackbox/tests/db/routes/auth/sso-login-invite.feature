Feature: An invitation lets an SSO login create its user and gives its roles

  - The instance trusts the identity providers `sso-login.feature` names:
    `mockoauth` speaks OAuth2, `mockopenid` speaks OpenID. Neither allows
    public registration nor gives a role of its own.
  - A `login: <provider>` row walks the code flow, the provider answering
    `profile`; its `invite` rides the login as the invitation link sends it.
    The callback checks the invitation before asking the provider: one it
    refuses creates no user and gives no role.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    invitation token it mails.
  - `<invited-role>` stands for the role the scenarios invite into.
  - Any other row is a request as the admin.

  Scenario: a first OAuth2 login with an invitation creates the user and gives its roles
    Then these requests get these responses:
      | request                        | response                       |
      | method: POST                   | code: 204                      |+
      | path: /users/invite            |                                |
      | payload:                       |                                |
      |   email: grace@sso.example.com |                                |
      |   roles:                       |                                |
      |     - <invited-role>           |                                |
      | login: mockoauth               | code: 200                      |+
      | invite: !jwt                   |                                |
      |   email: grace@sso.example.com |                                |
      |   scope: invite                |                                |
      | profile:                       |                                |
      |   sub: grace-oauth             |                                |
      |   email: grace@sso.example.com |                                |
      | method: GET                    | code: 200                      |+
      | path: /users                   | body:                          |
      | query:                         |   data:                        |
      |   fields: provider,roles.role  |     - provider: mockoauth      |
      |   filter[email][_eq]: >-       |       roles:                   |
      |     grace@sso.example.com      |         - role: <invited-role> |
      | method: POST                   | code: 200                      |+
      | path: /graphql/system          | body:                          |
      | payload:                       |   data:                        |
      |   query: >-                    |     invites: []                |
      |     { invites(filter:          |                                |
      |     {email: {_eq:              |                                |
      |     "grace@sso.example.com"}}) |                                |
      |     { role { id } } }          |                                |

  Scenario: a first OAuth2 login without an invitation creates no user
    Then these requests get these responses:
      | request                         | response   |
      | login: mockoauth                | code: 401  |+
      | profile:                        |            |
      |   sub: hopper-oauth             |            |
      |   email: hopper@sso.example.com |            |
      | method: GET                     | code: 200  |+
      | path: /users                    | body:      |
      | query:                          |   data: [] |
      |   fields: id                    |            |
      |   filter[email][_eq]: >-        |            |
      |     hopper@sso.example.com      |            |

  Scenario: a first OpenID login with an invitation creates the user and gives its roles
    Then these requests get these responses:
      | request                            | response                       |
      | method: POST                       | code: 204                      |+
      | path: /users/invite                |                                |
      | payload:                           |                                |
      |   email: katherine@sso.example.com |                                |
      |   roles:                           |                                |
      |     - <invited-role>               |                                |
      | login: mockopenid                  | code: 200                      |+
      | invite: !jwt                       |                                |
      |   email: katherine@sso.example.com |                                |
      |   scope: invite                    |                                |
      | profile:                           |                                |
      |   sub: katherine-openid            |                                |
      |   email: katherine@sso.example.com |                                |
      | method: GET                        | code: 200                      |+
      | path: /users                       | body:                          |
      | query:                             |   data:                        |
      |   fields: provider,roles.role      |     - provider: mockopenid     |
      |   filter[email][_eq]: >-           |       roles:                   |
      |     katherine@sso.example.com      |         - role: <invited-role> |
      | method: POST                       | code: 200                      |+
      | path: /graphql/system              | body:                          |
      | payload:                           |   data:                        |
      |   query: >-                        |     invites: []                |
      |     { invites(filter:              |                                |
      |     {email: {_eq:                  |                                |
      |     "katherine@sso.example.com"}}) |                                |
      |     { role { id } } }              |                                |

  Scenario: a refused invitation creates no user and gives no role
    Then these requests get these responses:
      | request                          | response                               |
      | method: POST                     | code: 204                              |+
      | path: /users/invite              |                                        |
      | payload:                         |                                        |
      |   email: refused@sso.example.com |                                        |
      |   roles:                         |                                        |
      |     - <invited-role>             |                                        |
      | login: mockoauth                 | code: 403                              |+
      | invite: !jwt                     | body:                                  |
      |   email: refused@sso.example.com |   errors:                              |
      |   scope: password-reset          |     - message: >-                      |
      | profile:                         |         Not an invite token            |
      |   sub: refused-oauth             |                                        |
      |   email: refused@sso.example.com |                                        |
      | login: mockoauth                 | code: 401                              |+
      | invite: !jwt                     | body:                                  |
      |   email: refused@sso.example.com |   errors:                              |
      |   scope: invite                  |     - message: >-                      |
      |   exp: 1                         |         Token expired.                 |
      | profile:                         |                                        |
      |   sub: refused-oauth             |                                        |
      |   email: refused@sso.example.com |                                        |
      | login: mockoauth                 | code: 403                              |+
      | invite: not-a-token              | body:                                  |
      | profile:                         |   errors:                              |
      |   sub: refused-oauth             |     - message: >-                      |
      |   email: refused@sso.example.com |         Invalid token.                 |
      | login: mockoauth                 | code: 400                              |+
      | invite: !jwt                     | body:                                  |
      |   email: never@sso.example.com   |   errors:                              |
      |   scope: invite                  |     - message: >-                      |
      | profile:                         |         Invalid payload. Email address |
      |   sub: refused-oauth             |         never@sso.example.com hasn't   |
      |   email: refused@sso.example.com |         been invited.                  |
      | method: GET                      | code: 200                              |+
      | path: /users                     | body:                                  |
      | query:                           |   data: []                             |
      |   fields: id                     |                                        |
      |   filter[email][_eq]: >-         |                                        |
      |     refused@sso.example.com      |                                        |
      | method: POST                     | code: 200                              |+
      | path: /graphql/system            | body:                                  |
      | payload:                         |   data:                                |
      |   query: >-                      |     invites:                           |
      |     { invites(filter:            |       - role:                          |
      |     {email: {_eq:                |           id: <invited-role>           |
      |     "refused@sso.example.com"}}) |                                        |
      |     { role { id } } }            |                                        |

  Scenario: a known user logging in with an invitation gets its roles
    Then these requests get these responses:
      | request                           | response                       |
      | method: POST                      | code: 200                      |+
      | path: /users                      |                                |
      | payload:                          |                                |
      |   email: mary@sso.example.com     |                                |
      |   provider: mockoauth             |                                |
      |   external_identifier: mary-oauth |                                |
      | method: POST                      | code: 204                      |+
      | path: /users/invite               |                                |
      | payload:                          |                                |
      |   email: mary@sso.example.com     |                                |
      |   roles:                          |                                |
      |     - <invited-role>              |                                |
      | login: mockoauth                  | code: 200                      |+
      | invite: !jwt                      |                                |
      |   email: mary@sso.example.com     |                                |
      |   scope: invite                   |                                |
      | profile:                          |                                |
      |   sub: mary-oauth                 |                                |
      |   email: mary@sso.example.com     |                                |
      | method: GET                       | code: 200                      |+
      | path: /users                      | body:                          |
      | query:                            |   data:                        |
      |   fields: provider,roles.role     |     - provider: mockoauth      |
      |   filter[email][_eq]: >-          |       roles:                   |
      |     mary@sso.example.com          |         - role: <invited-role> |
      | method: POST                      | code: 200                      |+
      | path: /graphql/system             | body:                          |
      | payload:                          |   data:                        |
      |   query: >-                       |     invites: []                |
      |     { invites(filter:             |                                |
      |     {email: {_eq:                 |                                |
      |     "mary@sso.example.com"}})     |                                |
      |     { role { id } } }             |                                |
