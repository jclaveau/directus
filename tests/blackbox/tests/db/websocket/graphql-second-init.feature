Feature: A GraphQL socket refuses a second connection_init before reading its token

  - The shared instance turns `WEBSOCKETS_GRAPHQL_ENABLED` on and keeps
    `WEBSOCKETS_GRAPHQL_AUTH` at its default, handshake,
    so a socket authenticates with the `access_token` of its first
    `connection_init`.
  - graphql-ws closes a socket sending a second `connection_init` with 4429
    "Too many initialisation requests". Directus closes it the same way
    before it authenticates the second token, so the socket keeps the
    accountability of the first one (#756 point 1).
  - A `sent` cell is a message the socket sends, or a `request:` sent over
    HTTP as the admin; its `received` cell lists every frame the socket gets
    after it, a `close:` standing for the socket's close.
  - `<run>` stands for a value unique to the scenario, any other `<name>`
    for a uuid of its own. Notes live in `test_ws_gql_reinit`.

  Scenario: A second connection_init with an invalid token closes the socket with 4429
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection         | action | fields |
      | <reader-policy> | test_ws_gql_reinit | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <reader> | reader-<run>@example.com | reader-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <reader> | <reader-role> | 1    |
    Then the socket exchanges these frames:
      | sent                          | received                                   |
      | type: connection_init         | - type: connection_ack                     |+
      | payload:                      |                                            |
      |   access_token: reader-<run>  |                                            |
      | type: connection_init         | - close: 4429                              |+
      | payload:                      |   reason: Too many initialisation requests |
      |   access_token: invalid-<run> |                                            |

  Scenario: A second connection_init with another user's token closes the socket with 4429
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection         | action | fields |
      | <reader-policy> | test_ws_gql_reinit | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <reader> | reader-<run>@example.com | reader-<run> |
      | <other>  | other-<run>@example.com  | other-<run>  |
    And the rows of directus_role_members:
      | id                  | user     | role          | sort |
      | <reader-membership> | <reader> | <reader-role> | 1    |
      | <other-membership>  | <other>  | <reader-role> | 1    |
    When the socket exchanges these frames:
      | sent                                          | received               |
      | type: connection_init                         | - type: connection_ack |+
      | payload:                                      |                        |
      |   access_token: reader-<run>                  |                        |
      | id: notes                                     | []                     |+
      | type: subscribe                               |                        |
      | payload:                                      |                        |
      |   query: >-                                   |                        |
      |     subscription {                            |                        |
      |     test_ws_gql_reinit_mutated(               |                        |
      |     event: create) { event data { label } } } |                        |
    And the subscription hears a note created as the admin
    Then the socket exchanges these frames:
      | sent                              | received                                   |
      | type: connection_init             | - close: 4429                              |+
      | payload:                          |   reason: Too many initialisation requests |
      |   access_token: other-<run>       |                                            |
      | request:                          | []                                         |+
      |   method: POST                    |                                            |
      |   path: /items/test_ws_gql_reinit |                                            |
      |   payload:                        |                                            |
      |     label: after-<run>            |                                            |

  Scenario: A valid first connection_init lets the socket hear the notes its user reads
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection         | action | fields |
      | <reader-policy> | test_ws_gql_reinit | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <reader> | reader-<run>@example.com | reader-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <reader> | <reader-role> | 1    |
    When the socket exchanges these frames:
      | sent                                          | received               |
      | type: connection_init                         | - type: connection_ack |+
      | payload:                                      |                        |
      |   access_token: reader-<run>                  |                        |
      | id: notes                                     | []                     |+
      | type: subscribe                               |                        |
      | payload:                                      |                        |
      |   query: >-                                   |                        |
      |     subscription {                            |                        |
      |     test_ws_gql_reinit_mutated(               |                        |
      |     event: create) { event data { label } } } |                        |
    And the subscription hears a note created as the admin
    Then the socket exchanges these frames:
      | sent                              | received                          |
      | request:                          | - id: notes                       |+
      |   method: POST                    |   type: next                      |
      |   path: /items/test_ws_gql_reinit |   payload:                        |
      |   payload:                        |     data:                         |
      |     label: after-<run>            |       test_ws_gql_reinit_mutated: |
      |                                   |         event: create             |
      |                                   |         data:                     |
      |                                   |           label: after-<run>      |
