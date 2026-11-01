Feature: Users are updated by query, by themselves and in their sessions

  - `!totp <secret>` stands for the one-time password an authenticator app
    shows for that secret now.
  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the session token a
    `remember_session: name` row stored. A response cell states the keys it
    checks.

  Scenario: users matched by a query take the update
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /users                        |           |
      | payload:                            |           |
      |   - email: first-<run>@example.com  |           |
      |     first_name: queried-<run>       |           |
      |     status: draft                   |           |
      |   - email: second-<run>@example.com |           |
      |     first_name: queried-<run>       |           |
      |     status: draft                   |           |
    Then these requests get these responses:
      | request                    | response                  |
      | method: PATCH              | code: 200                 |+
      | path: /users               | body:                     |
      | payload:                   |   data:                   |
      |   query:                   |     - last_name: by-query |
      |     filter:                |     - last_name: by-query |
      |       first_name:          |                           |
      |         _eq: queried-<run> |                           |
      |   data:                    |                           |
      |     last_name: by-query    |                           |

  Scenario: users created together with one email twice are refused
    Then these requests get these responses:
      | request                            | response                            |
      | method: POST                       | code: 400                           |+
      | path: /users                       | body:                               |
      | payload:                           |   errors:                           |
      |   - email: Twice-<run>@example.com |     - message: >-                   |
      |   - email: twice-<run>@example.com |         Value                       |
      |                                    |         "[twice-<run>@example.com]" |
      |                                    |         for field "email" in        |
      |                                    |         collection                  |
      |                                    |         "directus_users" has        |
      |                                    |         to be unique.               |

  Scenario: an admin updates their own name and two-factor secret
    Given these requests are sent:
      | request                         | response  |
      | method: POST                    | code: 200 |+
      | path: /policies                 |           |
      | payload:                        |           |
      |   id: <self-policy>             |           |
      |   name: self-<run>              |           |
      |   app_access: true              |           |
      |   admin_access: true            |           |
      | method: POST                    | code: 200 |+
      | path: /users                    |           |
      | payload:                        |           |
      |   id: <self-user>               |           |
      |   email: self-<run>@example.com |           |
      |   token: <self-token>           |           |
      |   policies:                     |           |
      |     - policy: <self-policy>     |           |
    Then these requests get these responses:
      | request                              | response                     |
      | as: <self-token>                     | code: 200                    |+
      | method: POST                         | body:                        |
      | path: /graphql/system                |   data:                      |
      | payload:                             |     update_users_me:         |
      |   query: >-                          |       last_name: graphql     |
      |     mutation {                       |                              |
      |     update_users_me(data: {          |                              |
      |     last_name: "graphql" })          |                              |
      |     { last_name } }                  |                              |
      | as: <self-token>                     | code: 204                    |+
      | method: POST                         |                              |
      | path: /users/me/tfa/enable           |                              |
      | payload:                             |                              |
      |   secret: JBSWY3DPEHPK3PXP           |                              |
      |   otp: !totp JBSWY3DPEHPK3PXP        |                              |
      | method: GET                          | code: 200                    |+
      | path: /users/<self-user>             | body:                        |
      | query:                               |   data:                      |
      |   fields: tfa_secret                 |     tfa_secret: '**********' |
      | method: POST                         | code: 204                    |+
      | path: /users/<self-user>/tfa/disable |                              |
      | method: GET                          | code: 200                    |+
      | path: /users/<self-user>             | body:                        |
      | query:                               |   data:                      |
      |   fields: tfa_secret                 |     tfa_secret: null         |

  Scenario: only an admin sets the provider and the external identifier
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <limited-policy>             |           |
      |   name: limited-<run>              |           |
      |   app_access: false                |           |
      |   admin_access: false              |           |
      | method: POST                       | code: 200 |+
      | path: /permissions                 |           |
      | payload:                           |           |
      |   policy: <limited-policy>         |           |
      |   collection: directus_users       |           |
      |   action: update                   |           |
      |   fields:                          |           |
      |     - '*'                          |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   id: <limited-user>               |           |
      |   email: limited-<run>@example.com |           |
      |   token: <limited-token>           |           |
      |   policies:                        |           |
      |     - policy: <limited-policy>     |           |
    Then these requests get these responses:
      | request                          | response                           |
      | as: <limited-token>              | code: 400                          |+
      | method: PATCH                    | body:                              |
      | path: /users/me                  |   errors:                          |
      | payload:                         |     - message: >-                  |
      |   provider: default              |         Invalid payload. You can't |
      |                                  |         change the "provider"      |
      |                                  |         value manually.            |
      | as: <limited-token>              | code: 400                          |+
      | method: PATCH                    | body:                              |
      | path: /users/me                  |   errors:                          |
      | payload:                         |     - message: >-                  |
      |   external_identifier: ext-<run> |         Invalid payload. You can't |
      |                                  |         change the                 |
      |                                  |         "external_identifier"      |
      |                                  |         value manually.            |
      | method: PATCH                    | code: 200                          |+
      | path: /users/<limited-user>      | body:                              |
      | payload:                         |   data:                            |
      |   provider: default              |     provider: default              |
      |   external_identifier: ext-<run> |     external_identifier: ext-<run> |
      | method: PATCH                    | code: 400                          |+
      | path: /users                     | body:                              |
      | payload:                         |   errors:                          |
      |   keys:                          |     - message: >-                  |
      |     - <limited-user>             |         Invalid payload. You can't |
      |     - <limited-user>             |         change the "tfa_secret"    |
      |   data:                          |         value manually.            |
      |     tfa_secret: JBSWY3DPEHPK3PXP |                                    |

  Scenario: a password change ends every other session of the user
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <session-policy>             |           |
      |   name: session-<run>              |           |
      |   app_access: true                 |           |
      |   admin_access: true               |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   id: <session-user>               |           |
      |   email: session-<run>@example.com |           |
      |   password: first-password         |           |
      |   policies:                        |           |
      |     - policy: <session-policy>     |           |
      | method: POST                       | code: 200 |+
      | path: /auth/login                  |           |
      | payload:                           |           |
      |   email: session-<run>@example.com |           |
      |   password: first-password         |           |
      |   mode: session                    |           |
      | remember_session: kept-session     |           |
      | method: POST                       | code: 200 |+
      | path: /auth/login                  |           |
      | payload:                           |           |
      |   email: session-<run>@example.com |           |
      |   password: first-password         |           |
      |   mode: session                    |           |
      | remember_session: other-session    |           |
    Then these requests get these responses:
      | request                     | response                             |
      | as: <kept-session>          | code: 200                            |+
      | method: PATCH               |                                      |
      | path: /users/me             |                                      |
      | payload:                    |                                      |
      |   password: second-password |                                      |
      | as: <other-session>         | code: 401                            |+
      | method: GET                 | body:                                |
      | path: /users/me             |   errors:                            |
      |                             |     - message: >-                    |
      |                             |         Invalid user credentials.    |
      | as: <kept-session>          | code: 200                            |+
      | method: GET                 | body:                                |
      | path: /users/me             |   data:                              |
      | query:                      |     email: session-<run>@example.com |
      |   fields: email             |                                      |
      | method: PATCH               | code: 200                            |+
      | path: /users/<session-user> | body:                                |
      | payload:                    |   data:                              |
      |   status: suspended         |     status: suspended                |
      | method: PATCH               | code: 200                            |+
      | path: /users/<session-user> | body:                                |
      | payload:                    |   data:                              |
      |   status: active            |     status: active                   |
      | as: <kept-session>          | code: 401                            |+
      | method: GET                 | body:                                |
      | path: /users/me             |   errors:                            |
      |                             |     - message: >-                    |
      |                             |         Invalid user credentials.    |
