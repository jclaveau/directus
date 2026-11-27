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
  - Both give the group "staff" the role 5b3e8f0a-... (sso_staff), the
    group "auditors" the role 0c6f2a9d-... (sso_auditors), anyone else the
    default role d70c0943-... A user in several mapped groups gets one role:
    the first the mapping lists.
  - Any other row is a request as the admin.

  Scenario: an OAuth2 login creates the user, a later one updates it
    Then these requests get these responses:
      | request                        | response                                   |
      | login: mockoauth               | code: 200                                  |+
      | profile:                       |                                            |
      |   sub: ada-oauth               |                                            |
      |   email: ada@sso.example.com   |                                            |
      |   given_name: Ada              |                                            |
      |   family_name: Lovelace        |                                            |
      |   groups: [staff]              |                                            |
      | method: GET                    | code: 200                                  |+
      | path: /users                   | body:                                      |
      | query:                         |   data:                                    |
      |   fields:                      |   - primary_identity:                      |
      |     - primary_identity.value   |       value: ada@sso.example.com           |
      |     - identities.kind          |     identities:                            |
      |     - identities.value         |     - kind: email                          |
      |     - identities.auth_data     |       value: ada@sso.example.com           |
      |     - first_name               |       auth_data: null                      |
      |     - last_name                |     - kind: mockoauth                      |
      |     - role                     |       value: ada-oauth                     |
      |   filter:                      |       auth_data:                           |
      |     primary_identity:          |         refreshToken: ada-oauth-refresh-2  |
      |       value:                   |     first_name: Ada                        |
      |         _eq: >-                |     last_name: Lovelace                    |
      |           ada@sso.example.com  |     role: >-                               |
      |   deep:                        |       5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04 |
      |     identities:                |                                            |
      |       _sort: kind              |                                            |
      | login: mockoauth               | code: 200                                  |+
      | profile:                       |                                            |
      |   sub: ada-oauth               |                                            |
      |   email: ada@sso.example.com   |                                            |
      |   given_name: Augusta          |                                            |
      |   family_name: King            |                                            |
      |   groups: []                   |                                            |
      | remember_session: ada_session  |                                            |
      | method: GET                    | code: 200                                  |+
      | path: /users                   | body:                                      |
      | query:                         |   data:                                    |
      |   fields:                      |   - primary_identity:                      |
      |     - primary_identity.value   |       value: ada@sso.example.com           |
      |     - identities.kind          |     identities:                            |
      |     - identities.value         |     - kind: email                          |
      |     - identities.auth_data     |       value: ada@sso.example.com           |
      |     - first_name               |       auth_data: null                      |
      |     - last_name                |     - kind: mockoauth                      |
      |     - role                     |       value: ada-oauth                     |
      |   filter:                      |       auth_data:                           |
      |     primary_identity:          |         refreshToken: ada-oauth-refresh-4  |
      |       value:                   |     first_name: Augusta                    |
      |         _eq: >-                |     last_name: King                        |
      |           ada@sso.example.com  |     role: >-                               |
      |   deep:                        |       d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |     identities:                |                                            |
      |       _sort: kind              |                                            |
      | method: POST                   | code: 200                                  |+
      | path: /auth/refresh            |                                            |
      | payload:                       |                                            |
      |   refresh_token: <ada_session> |                                            |
      |   mode: json                   |                                            |
      | method: GET                    | code: 200                                  |+
      | path: /users                   | body:                                      |
      | query:                         |   data:                                    |
      |   fields:                      |   - identities:                            |
      |     - identities.kind          |     - kind: email                          |
      |     - identities.auth_data     |       auth_data: null                      |
      |   filter:                      |     - kind: mockoauth                      |
      |     primary_identity:          |       auth_data:                           |
      |       value:                   |         refreshToken: ada-oauth-refresh-5  |
      |         _eq: >-                |                                            |
      |           ada@sso.example.com  |                                            |
      |   deep:                        |                                            |
      |     identities:                |                                            |
      |       _sort: kind              |                                            |

  Scenario: an OpenID login creates the user, a later one updates it
    Then these requests get these responses:
      | request                          | response                                     |
      | login: mockopenid                | code: 200                                    |+
      | profile:                         |                                              |
      |   sub: grace-openid              |                                              |
      |   email: grace@sso.example.com   |                                              |
      |   given_name: Grace              |                                              |
      |   family_name: Hopper            |                                              |
      | method: GET                      | code: 200                                    |+
      | path: /users                     | body:                                        |
      | query:                           |   data:                                      |
      |   fields:                        |   - primary_identity:                        |
      |     - primary_identity.value     |       value: grace@sso.example.com           |
      |     - identities.kind            |     identities:                              |
      |     - identities.value           |     - kind: email                            |
      |     - identities.auth_data       |       value: grace@sso.example.com           |
      |     - first_name                 |       auth_data: null                        |
      |     - last_name                  |     - kind: mockopenid                       |
      |     - role                       |       value: grace-openid                    |
      |   filter:                        |       auth_data:                             |
      |     primary_identity:            |         refreshToken: grace-openid-refresh-2 |
      |       value:                     |     first_name: Grace                        |
      |         _eq: >-                  |     last_name: Hopper                        |
      |           grace@sso.example.com  |     role: >-                                 |
      |   deep:                          |       d70c0943-5b55-4c5d-a613-f539a27a57f5   |
      |     identities:                  |                                              |
      |       _sort: kind                |                                              |
      | login: mockopenid                | code: 200                                    |+
      | profile:                         |                                              |
      |   sub: grace-openid              |                                              |
      |   email: grace@sso.example.com   |                                              |
      |   given_name: Amazing            |                                              |
      |   family_name: Grace             |                                              |
      | remember_session: grace_session  |                                              |
      | method: GET                      | code: 200                                    |+
      | path: /users                     | body:                                        |
      | query:                           |   data:                                      |
      |   fields:                        |   - primary_identity:                        |
      |     - primary_identity.value     |       value: grace@sso.example.com           |
      |     - identities.kind            |     identities:                              |
      |     - identities.value           |     - kind: email                            |
      |     - identities.auth_data       |       value: grace@sso.example.com           |
      |     - first_name                 |       auth_data: null                        |
      |     - last_name                  |     - kind: mockopenid                       |
      |     - role                       |       value: grace-openid                    |
      |   filter:                        |       auth_data:                             |
      |     primary_identity:            |         refreshToken: grace-openid-refresh-4 |
      |       value:                     |     first_name: Amazing                      |
      |         _eq: >-                  |     last_name: Grace                         |
      |           grace@sso.example.com  |     role: >-                                 |
      |   deep:                          |       d70c0943-5b55-4c5d-a613-f539a27a57f5   |
      |     identities:                  |                                              |
      |       _sort: kind                |                                              |
      | method: POST                     | code: 200                                    |+
      | path: /auth/refresh              |                                              |
      | payload:                         |                                              |
      |   refresh_token: <grace_session> |                                              |
      |   mode: json                     |                                              |
      | method: GET                      | code: 200                                    |+
      | path: /users                     | body:                                        |
      | query:                           |   data:                                      |
      |   fields:                        |   - identities:                              |
      |     - identities.kind            |     - kind: email                            |
      |     - identities.auth_data       |       auth_data: null                        |
      |   filter:                        |     - kind: mockopenid                       |
      |     primary_identity:            |       auth_data:                             |
      |       value:                     |         refreshToken: grace-openid-refresh-5 |
      |         _eq: >-                  |                                              |
      |           grace@sso.example.com  |                                              |
      |   deep:                          |                                              |
      |     identities:                  |                                              |
      |       _sort: kind                |                                              |

  Scenario: an OAuth2 user in two mapped groups gets the role mapped first
    Then these requests get these responses:
      | request                       | response                                   |
      | login: mockoauth              | code: 200                                  |+
      | profile:                      |                                            |
      |   sub: kay-oauth              |                                            |
      |   email: kay@sso.example.com  |                                            |
      |   given_name: Kay             |                                            |
      |   family_name: Antonelli      |                                            |
      |   groups: [auditors, staff]   |                                            |
      | method: GET                   | code: 200                                  |+
      | path: /users                  | body:                                      |
      | query:                        |   data:                                    |
      |   fields:                     |   - role: >-                               |
      |     - role                    |       5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04 |
      |   filter:                     |                                            |
      |     primary_identity:         |                                            |
      |       value:                  |                                            |
      |         _eq: >-               |                                            |
      |           kay@sso.example.com |                                            |
      | login: mockoauth              | code: 200                                  |+
      | profile:                      |                                            |
      |   sub: kay-oauth              |                                            |
      |   email: kay@sso.example.com  |                                            |
      |   given_name: Kay             |                                            |
      |   family_name: Antonelli      |                                            |
      |   groups: [auditors]          |                                            |
      | method: GET                   | code: 200                                  |+
      | path: /users                  | body:                                      |
      | query:                        |   data:                                    |
      |   fields:                     |   - role: >-                               |
      |     - role                    |       0c6f2a9d-3e18-4b57-9d40-7a1e5c8b2f63 |
      |   filter:                     |                                            |
      |     primary_identity:         |                                            |
      |       value:                  |                                            |
      |         _eq: >-               |                                            |
      |           kay@sso.example.com |                                            |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete | with |
      | 1       | directus_access          | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity        | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles           | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_sessions        | 0      | 1      | 0      | 1      | 0    |
      | 1       | directus_settings        | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_user_identities | 3      | 2      | 1      | 0      | 0    |
      | 1       | directus_users           | 1      | 1      | 2      | 0      | 0    |
      | 2       | directus_users           | 2      | 0      | 0      | 0      | 0    |
      | 3       | directus_access          | 3      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity        | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_roles           | 2      | 0      | 0      | 0      | 0    |
      | 3       | directus_sessions        | 0      | 1      | 0      | 1      | 0    |
      | 3       | directus_settings        | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_user_identities | 3      | 0      | 2      | 0      | 0    |
      | 3       | directus_users           | 2      | 0      | 2      | 0      | 0    |
      | 4       | directus_access          | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_collections     | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_fields          | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_relations       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_roles           | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_users           | 2      | 0      | 0      | 0      | 0    |
      | 4       | geometry_columns         | 0      | 0      | 0      | 0      | 1    |
      | 4       | information_schema       | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_constraint            | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_index                 | 2      | 0      | 0      | 0      | 0    |
      | 4       | pg_proc                  | 1      | 0      | 0      | 0      | 0    |

  Scenario: an OpenID user's group maps their role, a later login changes it
    Then these requests get these responses:
      | request                       | response                                   |
      | login: mockopenid             | code: 200                                  |+
      | profile:                      |                                            |
      |   sub: lin-openid             |                                            |
      |   email: lin@sso.example.com  |                                            |
      |   given_name: Lin             |                                            |
      |   family_name: Hua            |                                            |
      |   groups: [staff]             |                                            |
      | method: GET                   | code: 200                                  |+
      | path: /users                  | body:                                      |
      | query:                        |   data:                                    |
      |   fields:                     |   - role: >-                               |
      |     - role                    |       5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04 |
      |   filter:                     |                                            |
      |     primary_identity:         |                                            |
      |       value:                  |                                            |
      |         _eq: >-               |                                            |
      |           lin@sso.example.com |                                            |
      | login: mockopenid             | code: 200                                  |+
      | profile:                      |                                            |
      |   sub: lin-openid             |                                            |
      |   email: lin@sso.example.com  |                                            |
      |   given_name: Lin             |                                            |
      |   family_name: Hua            |                                            |
      |   groups: [auditors]          |                                            |
      | method: GET                   | code: 200                                  |+
      | path: /users                  | body:                                      |
      | query:                        |   data:                                    |
      |   fields:                     |   - role: >-                               |
      |     - role                    |       0c6f2a9d-3e18-4b57-9d40-7a1e5c8b2f63 |
      |   filter:                     |                                            |
      |     primary_identity:         |                                            |
      |       value:                  |                                            |
      |         _eq: >-               |                                            |
      |           lin@sso.example.com |                                            |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete | with |
      | 1       | directus_access          | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity        | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles           | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_sessions        | 0      | 1      | 0      | 1      | 0    |
      | 1       | directus_settings        | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_user_identities | 3      | 2      | 1      | 0      | 0    |
      | 1       | directus_users           | 1      | 1      | 2      | 0      | 0    |
      | 2       | directus_users           | 2      | 0      | 0      | 0      | 0    |
      | 3       | directus_access          | 3      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity        | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_roles           | 2      | 0      | 0      | 0      | 0    |
      | 3       | directus_sessions        | 0      | 1      | 0      | 1      | 0    |
      | 3       | directus_settings        | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_user_identities | 3      | 0      | 2      | 0      | 0    |
      | 3       | directus_users           | 2      | 0      | 2      | 0      | 0    |
      | 4       | directus_access          | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_collections     | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_fields          | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_relations       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_roles           | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_users           | 2      | 0      | 0      | 0      | 0    |
      | 4       | geometry_columns         | 0      | 0      | 0      | 0      | 1    |
      | 4       | information_schema       | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_constraint            | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_index                 | 2      | 0      | 0      | 0      | 0    |
      | 4       | pg_proc                  | 1      | 0      | 0      | 0      | 0    |
