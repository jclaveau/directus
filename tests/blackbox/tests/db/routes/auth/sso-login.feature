Feature: A first SSO login creates the user, a later one updates it

  - The instance trusts two identity providers the file starts on ports of
    their own: `mockoauth` speaks OAuth2, `mockopenid` speaks OpenID and signs
    an `id_token`. Both sync the user's profile on every login.
  - A `login: <provider>` row walks the code flow, the provider answering
    `profile`; `remember_session: name` keeps the Directus refresh token it
    got, which `<name>` stands for afterwards.
  - The providers hand `<sub>-refresh-<n>` out as refresh tokens, n counting
    the ones that subject got. Directus stores the one a login brings, then
    trades it at once, and again on every refresh: it keeps the last one.
  - `mockoauth` gives the group "staff" the role 5b3e8f0a-... (sso_staff),
    anyone else the default role d70c0943-...; `mockopenid` maps no group.
  - Any other row is a request as the admin.

  Scenario: an OAuth2 login creates the user, a later one updates it
    Then these requests get these responses:
      | request                            | response                                   |
      | login: mockoauth                   | code: 200                                  |+
      | profile:                           |                                            |
      |   sub: ada-oauth                   |                                            |
      |   email: ada@sso.example.com       |                                            |
      |   given_name: Ada                  |                                            |
      |   family_name: Lovelace            |                                            |
      |   groups: [staff]                  |                                            |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data:                                    |
      |   fields:                          |   - provider: mockoauth                    |
      |     - provider                     |     external_identifier: ada-oauth         |
      |     - external_identifier          |     email: ada@sso.example.com             |
      |     - email                        |     first_name: Ada                        |
      |     - first_name                   |     last_name: Lovelace                    |
      |     - last_name                    |     role: >-                               |
      |     - role                         |       5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04 |
      |     - auth_data                    |     auth_data:                             |
      |   filter[email][_eq]: >-           |       refreshToken: ada-oauth-refresh-2    |
      |     ada@sso.example.com            |                                            |
      | login: mockoauth                   | code: 200                                  |+
      | profile:                           |                                            |
      |   sub: ada-oauth                   |                                            |
      |   email: ada@sso.example.com       |                                            |
      |   given_name: Augusta              |                                            |
      |   family_name: King                |                                            |
      |   groups: []                       |                                            |
      | remember_session: ada_session      |                                            |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data:                                    |
      |   fields:                          |   - provider: mockoauth                    |
      |     - provider                     |     external_identifier: ada-oauth         |
      |     - external_identifier          |     email: ada@sso.example.com             |
      |     - email                        |     first_name: Augusta                    |
      |     - first_name                   |     last_name: King                        |
      |     - last_name                    |     role: >-                               |
      |     - role                         |       d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |     - auth_data                    |     auth_data:                             |
      |   filter[email][_eq]: >-           |       refreshToken: ada-oauth-refresh-4    |
      |     ada@sso.example.com            |                                            |
      | method: POST                       | code: 200                                  |+
      | path: /auth/refresh                |                                            |
      | payload:                           |                                            |
      |   refresh_token: <ada_session>     |                                            |
      |   mode: json                       |                                            |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data:                                    |
      |   fields:                          |   - auth_data:                             |
      |     - auth_data                    |       refreshToken: ada-oauth-refresh-5    |
      |   filter[email][_eq]: >-           |                                            |
      |     ada@sso.example.com            |                                            |

  Scenario: an OpenID login creates the user, a later one updates it
    Then these requests get these responses:
      | request                            | response                                   |
      | login: mockopenid                  | code: 200                                  |+
      | profile:                           |                                            |
      |   sub: grace-openid                |                                            |
      |   email: grace@sso.example.com     |                                            |
      |   given_name: Grace                |                                            |
      |   family_name: Hopper              |                                            |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data:                                    |
      |   fields:                          |   - provider: mockopenid                   |
      |     - provider                     |     external_identifier: grace-openid      |
      |     - external_identifier          |     email: grace@sso.example.com           |
      |     - email                        |     first_name: Grace                      |
      |     - first_name                   |     last_name: Hopper                      |
      |     - last_name                    |     role: >-                               |
      |     - role                         |       d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |     - auth_data                    |     auth_data:                             |
      |   filter[email][_eq]: >-           |       refreshToken: grace-openid-refresh-2 |
      |     grace@sso.example.com          |                                            |
      | login: mockopenid                  | code: 200                                  |+
      | profile:                           |                                            |
      |   sub: grace-openid                |                                            |
      |   email: grace@sso.example.com     |                                            |
      |   given_name: Amazing              |                                            |
      |   family_name: Grace               |                                            |
      | remember_session: grace_session    |                                            |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data:                                    |
      |   fields:                          |   - provider: mockopenid                   |
      |     - provider                     |     external_identifier: grace-openid      |
      |     - external_identifier          |     email: grace@sso.example.com           |
      |     - email                        |     first_name: Amazing                    |
      |     - first_name                   |     last_name: Grace                       |
      |     - last_name                    |     role: >-                               |
      |     - role                         |       d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |     - auth_data                    |     auth_data:                             |
      |   filter[email][_eq]: >-           |       refreshToken: grace-openid-refresh-4 |
      |     grace@sso.example.com          |                                            |
      | method: POST                       | code: 200                                  |+
      | path: /auth/refresh                |                                            |
      | payload:                           |                                            |
      |   refresh_token: <grace_session>   |                                            |
      |   mode: json                       |                                            |
      | method: GET                        | code: 200                                  |+
      | path: /users                       | body:                                      |
      | query:                             |   data:                                    |
      |   fields:                          |   - auth_data:                             |
      |     - auth_data                    |       refreshToken: grace-openid-refresh-5 |
      |   filter[email][_eq]: >-           |                                            |
      |     grace@sso.example.com          |                                            |
