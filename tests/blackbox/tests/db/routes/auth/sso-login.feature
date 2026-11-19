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
    the first the mapping lists. That row is `managed_by: auth:<provider>`,
    and a later login replaces only that provider's rows.
  - Any other row is a request as the admin.

  Scenario: an OAuth2 login creates the user, a later one updates it
    Then these requests get these responses:
      | request                        | response                                     |
      | login: mockoauth               | code: 200                                    |+
      | profile:                       |                                              |
      |   sub: ada-oauth               |                                              |
      |   email: ada@sso.example.com   |                                              |
      |   given_name: Ada              |                                              |
      |   family_name: Lovelace        |                                              |
      |   groups: [staff]              |                                              |
      | method: GET                    | code: 200                                    |+
      | path: /users                   | body:                                        |
      | query:                         |   data:                                      |
      |   fields:                      |   - provider: mockoauth                      |
      |     - provider                 |     external_identifier: ada-oauth           |
      |     - external_identifier      |     email: ada@sso.example.com               |
      |     - email                    |     first_name: Ada                          |
      |     - first_name               |     last_name: Lovelace                      |
      |     - last_name                |     roles:                                   |
      |     - roles.role               |     - role: >-                               |
      |     - auth_data                |         5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04 |
      |   filter[email][_eq]: >-       |     auth_data:                               |
      |     ada@sso.example.com        |       refreshToken: ada-oauth-refresh-2      |
      | login: mockoauth               | code: 200                                    |+
      | profile:                       |                                              |
      |   sub: ada-oauth               |                                              |
      |   email: ada@sso.example.com   |                                              |
      |   given_name: Augusta          |                                              |
      |   family_name: King            |                                              |
      |   groups: []                   |                                              |
      | remember_session: ada_session  |                                              |
      | method: GET                    | code: 200                                    |+
      | path: /users                   | body:                                        |
      | query:                         |   data:                                      |
      |   fields:                      |   - provider: mockoauth                      |
      |     - provider                 |     external_identifier: ada-oauth           |
      |     - external_identifier      |     email: ada@sso.example.com               |
      |     - email                    |     first_name: Augusta                      |
      |     - first_name               |     last_name: King                          |
      |     - last_name                |     roles:                                   |
      |     - roles.role               |     - role: >-                               |
      |     - auth_data                |         d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |   filter[email][_eq]: >-       |     auth_data:                               |
      |     ada@sso.example.com        |       refreshToken: ada-oauth-refresh-4      |
      | method: POST                   | code: 200                                    |+
      | path: /auth/refresh            |                                              |
      | payload:                       |                                              |
      |   refresh_token: <ada_session> |                                              |
      |   mode: json                   |                                              |
      | method: GET                    | code: 200                                    |+
      | path: /users                   | body:                                        |
      | query:                         |   data:                                      |
      |   fields:                      |   - auth_data:                               |
      |     - auth_data                |       refreshToken: ada-oauth-refresh-5      |
      |   filter[email][_eq]: >-       |                                              |
      |     ada@sso.example.com        |                                              |

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
      |   fields:                        |   - provider: mockopenid                     |
      |     - provider                   |     external_identifier: grace-openid        |
      |     - external_identifier        |     email: grace@sso.example.com             |
      |     - email                      |     first_name: Grace                        |
      |     - first_name                 |     last_name: Hopper                        |
      |     - last_name                  |     roles:                                   |
      |     - roles.role                 |     - role: >-                               |
      |     - auth_data                  |         d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |   filter[email][_eq]: >-         |     auth_data:                               |
      |     grace@sso.example.com        |       refreshToken: grace-openid-refresh-2   |
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
      |   fields:                        |   - provider: mockopenid                     |
      |     - provider                   |     external_identifier: grace-openid        |
      |     - external_identifier        |     email: grace@sso.example.com             |
      |     - email                      |     first_name: Amazing                      |
      |     - first_name                 |     last_name: Grace                         |
      |     - last_name                  |     roles:                                   |
      |     - roles.role                 |     - role: >-                               |
      |     - auth_data                  |         d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |   filter[email][_eq]: >-         |     auth_data:                               |
      |     grace@sso.example.com        |       refreshToken: grace-openid-refresh-4   |
      | method: POST                     | code: 200                                    |+
      | path: /auth/refresh              |                                              |
      | payload:                         |                                              |
      |   refresh_token: <grace_session> |                                              |
      |   mode: json                     |                                              |
      | method: GET                      | code: 200                                    |+
      | path: /users                     | body:                                        |
      | query:                           |   data:                                      |
      |   fields:                        |   - auth_data:                               |
      |     - auth_data                  |       refreshToken: grace-openid-refresh-5   |
      |   filter[email][_eq]: >-         |                                              |
      |     grace@sso.example.com        |                                              |

  Scenario: an OAuth2 user in two mapped groups gets the role mapped first
    Then these requests get these responses:
      | request                      | response                                     |
      | login: mockoauth             | code: 200                                    |+
      | profile:                     |                                              |
      |   sub: kay-oauth             |                                              |
      |   email: kay@sso.example.com |                                              |
      |   given_name: Kay            |                                              |
      |   family_name: Antonelli     |                                              |
      |   groups: [auditors, staff]  |                                              |
      | method: GET                  | code: 200                                    |+
      | path: /users                 | body:                                        |
      | query:                       |   data:                                      |
      |   fields:                    |   - roles:                                   |
      |     - roles.role             |     - role: >-                               |
      |   filter[email][_eq]: >-     |         5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04 |
      |     kay@sso.example.com      |                                              |
      | login: mockoauth             | code: 200                                    |+
      | profile:                     |                                              |
      |   sub: kay-oauth             |                                              |
      |   email: kay@sso.example.com |                                              |
      |   given_name: Kay            |                                              |
      |   family_name: Antonelli     |                                              |
      |   groups: [auditors]         |                                              |
      | method: GET                  | code: 200                                    |+
      | path: /users                 | body:                                        |
      | query:                       |   data:                                      |
      |   fields:                    |   - roles:                                   |
      |     - roles.role             |     - role: >-                               |
      |   filter[email][_eq]: >-     |         0c6f2a9d-3e18-4b57-9d40-7a1e5c8b2f63 |
      |     kay@sso.example.com      |                                              |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members | 2      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_sessions     | 0      | 1      | 0      | 1      | 0    |
      | 1       | directus_settings     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 4      | 1      | 2      | 0      | 0    |
      | 2       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 2       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_role_members | 2      | 0      | 0      | 0      | 0    |
      | 2       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_users        | 2      | 0      | 0      | 0      | 0    |
      | 2       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 2       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 2       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 2       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 2       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_access       | 3      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_role_members | 2      | 1      | 0      | 1      | 0    |
      | 3       | directus_roles        | 2      | 0      | 0      | 0      | 0    |
      | 3       | directus_sessions     | 0      | 1      | 0      | 2      | 0    |
      | 3       | directus_settings     | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_users        | 4      | 0      | 3      | 0      | 0    |
      | 4       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_role_members | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_users        | 2      | 0      | 0      | 0      | 0    |
      | 4       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 4       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 4       | pg_proc               | 1      | 0      | 0      | 0      | 0    |

  Scenario: a later login keeps the role an admin gave the user
    Then these requests get these responses:
      | request                                    | response                         |
      | method: POST                               | code: 200                        |+
      | path: /users                               |                                  |
      | payload:                                   |                                  |
      |   provider: mockoauth                      |                                  |
      |   external_identifier: lee-oauth           |                                  |
      |   email: lee@sso.example.com               |                                  |
      |   roles:                                   |                                  |
      |   - role: >-                               |                                  |
      |       d70c0943-5b55-4c5d-a613-f539a27a57f5 |                                  |
      | login: mockoauth                           | code: 200                        |+
      | profile:                                   |                                  |
      |   sub: lee-oauth                           |                                  |
      |   email: lee@sso.example.com               |                                  |
      |   groups: [staff]                          |                                  |
      | method: GET                                | code: 200                        |+
      | path: /users                               | body:                            |
      | query:                                     |   data:                          |
      |   fields:                                  |   - roles:                       |
      |     - roles.role.name                      |     - role:                      |
      |     - roles.managed_by                     |         name: sso_staff          |
      |   deep: >-                                 |       managed_by: auth:mockoauth |
      |     {"roles":{"_sort":["managed_by"]}}     |     - role:                      |
      |   filter[email][_eq]: >-                   |         name: Tests Flow Role    |
      |     lee@sso.example.com                    |       managed_by: null           |
      | login: mockoauth                           | code: 200                        |+
      | profile:                                   |                                  |
      |   sub: lee-oauth                           |                                  |
      |   email: lee@sso.example.com               |                                  |
      |   groups: [auditors]                       |                                  |
      | method: GET                                | code: 200                        |+
      | path: /users                               | body:                            |
      | query:                                     |   data:                          |
      |   fields:                                  |   - roles:                       |
      |     - roles.role.name                      |     - role:                      |
      |     - roles.managed_by                     |         name: sso_auditors       |
      |   deep: >-                                 |       managed_by: auth:mockoauth |
      |     {"roles":{"_sort":["managed_by"]}}     |     - role:                      |
      |   filter[email][_eq]: >-                   |         name: Tests Flow Role    |
      |     lee@sso.example.com                    |       managed_by: null           |
    And on postgres the requests ran these statements:
      | request | table  | select | insert | update | delete | with |
      | 1       | (none) | 0      | 0      | 0      | 0      | 0    |
      | 2       | (none) | 0      | 0      | 0      | 0      | 0    |
      | 3       | (none) | 0      | 0      | 0      | 0      | 0    |
      | 4       | (none) | 0      | 0      | 0      | 0      | 0    |
      | 5       | (none) | 0      | 0      | 0      | 0      | 0    |

  Scenario: an OpenID user's group maps their role, a later login changes it
    Then these requests get these responses:
      | request                      | response                                     |
      | login: mockopenid            | code: 200                                    |+
      | profile:                     |                                              |
      |   sub: lin-openid            |                                              |
      |   email: lin@sso.example.com |                                              |
      |   given_name: Lin            |                                              |
      |   family_name: Hua           |                                              |
      |   groups: [staff]            |                                              |
      | method: GET                  | code: 200                                    |+
      | path: /users                 | body:                                        |
      | query:                       |   data:                                      |
      |   fields:                    |   - roles:                                   |
      |     - roles.role             |     - role: >-                               |
      |   filter[email][_eq]: >-     |         5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04 |
      |     lin@sso.example.com      |                                              |
      | login: mockopenid            | code: 200                                    |+
      | profile:                     |                                              |
      |   sub: lin-openid            |                                              |
      |   email: lin@sso.example.com |                                              |
      |   given_name: Lin            |                                              |
      |   family_name: Hua           |                                              |
      |   groups: [auditors]         |                                              |
      | method: GET                  | code: 200                                    |+
      | path: /users                 | body:                                        |
      | query:                       |   data:                                      |
      |   fields:                    |   - roles:                                   |
      |     - roles.role             |     - role: >-                               |
      |   filter[email][_eq]: >-     |         0c6f2a9d-3e18-4b57-9d40-7a1e5c8b2f63 |
      |     lin@sso.example.com      |                                              |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete | with |
      | 1       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 1       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 1       | directus_role_members | 2      | 1      | 0      | 0      | 0    |
      | 1       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_sessions     | 0      | 1      | 0      | 1      | 0    |
      | 1       | directus_settings     | 1      | 0      | 0      | 0      | 0    |
      | 1       | directus_users        | 4      | 1      | 2      | 0      | 0    |
      | 2       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 2       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_role_members | 2      | 0      | 0      | 0      | 0    |
      | 2       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 2       | directus_users        | 2      | 0      | 0      | 0      | 0    |
      | 2       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 2       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 2       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 2       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 2       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_access       | 3      | 0      | 0      | 0      | 0    |
      | 3       | directus_activity     | 0      | 1      | 0      | 0      | 0    |
      | 3       | directus_role_members | 2      | 1      | 0      | 1      | 0    |
      | 3       | directus_roles        | 2      | 0      | 0      | 0      | 0    |
      | 3       | directus_sessions     | 0      | 1      | 0      | 2      | 0    |
      | 3       | directus_settings     | 1      | 0      | 0      | 0      | 0    |
      | 3       | directus_users        | 4      | 0      | 3      | 0      | 0    |
      | 4       | directus_access       | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_collections  | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_fields       | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_relations    | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_role_members | 2      | 0      | 0      | 0      | 0    |
      | 4       | directus_roles        | 1      | 0      | 0      | 0      | 0    |
      | 4       | directus_users        | 2      | 0      | 0      | 0      | 0    |
      | 4       | geometry_columns      | 0      | 0      | 0      | 0      | 1    |
      | 4       | information_schema    | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_constraint         | 1      | 0      | 0      | 0      | 0    |
      | 4       | pg_index              | 2      | 0      | 0      | 0      | 0    |
      | 4       | pg_proc               | 1      | 0      | 0      | 0      | 0    |
