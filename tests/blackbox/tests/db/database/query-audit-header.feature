Feature: A request reports the SQL it ran, one entry per transaction

  - The instance: QUERY_AUDIT_HEADER `x-query-audit`, QUERY_AUDIT_LEVEL
    `statements`, CORS on.
  - A request authenticates as the admin unless its headers say otherwise.
  - A response states the keys it checks; `x-query-audit` reads parsed, its
    durations unstated.
  - Authenticating reads `directus_users`: every header starts with that entry.

  Scenario: a create reports its transaction and the reads around it
    Then on postgres these requests get these responses:
      | request                     | response                    |
      | method: POST                | code: 200                   |+
      | path: /items/audit_articles | headers:                    |
      | payload:                    |   x-query-audit:            |
      |   - title: a                |     - tables:               |
      |   - title: b                |         directus_users:     |
      |   - title: c                |           select: 1         |
      |                             |     - outcome: commit       |
      |                             |       tables:               |
      |                             |         audit_articles:     |
      |                             |           insert: 1         |
      |                             |         directus_activity:  |
      |                             |           insert: 1         |
      |                             |         directus_revisions: |
      |                             |           insert: 1         |
      |                             |     - tables:               |
      |                             |         audit_articles:     |
      |                             |           select: 1         |

  Scenario: a pool read inside a transaction is an entry of its own
    Then except on sqlite3, these requests get these responses:
      | request                      | response                   |
      | method: GET                  | code: 200                  |+
      | path: /audit-probe/pool-read | headers:                   |
      |                              |   x-query-audit:           |
      |                              |     - tables:              |
      |                              |         directus_users:    |
      |                              |           select: 1        |
      |                              |     - outcome: commit      |
      |                              |       tables:              |
      |                              |         directus_settings: |
      |                              |           select: 1        |
      |                              |     - tables:              |
      |                              |         directus_settings: |
      |                              |           select: 1        |

  Scenario: reads through the transaction share its entry
    Then these requests get these responses:
      | request                             | response                   |
      | method: GET                         | code: 200                  |+
      | path: /audit-probe/transaction-read | headers:                   |
      |                                     |   x-query-audit:           |
      |                                     |     - tables:              |
      |                                     |         directus_users:    |
      |                                     |           select: 1        |
      |                                     |     - outcome: commit      |
      |                                     |       tables:              |
      |                                     |         directus_settings: |
      |                                     |           select: 2        |
    And on postgres these requests get these responses:
      | request                             | response                             |
      | method: GET                         | code: 200                            |+
      | path: /audit-probe/transaction-read | headers:                             |
      |                                     |   x-query-audit:                     |
      |                                     |     - tables:                        |
      |                                     |         directus_users:              |
      |                                     |           select: 1                  |
      |                                     |     - statements:                    |
      |                                     |         - sql: >-                    |
      |                                     |             select "id"              |
      |                                     |             from "directus_settings" |
      |                                     |             where "id" = $1          |
      |                                     |           count: 2                   |

  Scenario: an admin asking full gets each run's bound values
    Then on postgres these requests get these responses:
      | request                             | response                             |
      | method: GET                         | code: 200                            |+
      | path: /audit-probe/transaction-read | headers:                             |
      | headers:                            |   x-query-audit:                     |
      |   x-query-audit: full               |     - tables:                        |
      |                                     |         directus_users:              |
      |                                     |           select: 1                  |
      |                                     |     - statements:                    |
      |                                     |         - sql: >-                    |
      |                                     |             select "id"              |
      |                                     |             from "directus_settings" |
      |                                     |             where "id" = $1          |
      |                                     |           count: 2                   |
      |                                     |           bindings:                  |
      |                                     |             - - 1                    |
      |                                     |             - - 1                    |

  Scenario: anyone else asking full gets the statements alone
    Then these requests get these responses:
      | request                             | response                |
      | method: GET                         | code: 403               |+
      | path: /audit-probe/transaction-read | headers:                |
      | headers:                            |   x-query-audit:        |
      |   authorization: >-                 |     - tables:           |
      |     Bearer <app access token>       |         directus_users: |
      |   x-query-audit: full               |           select: 1     |
      |                                     |       statements:       |
      |                                     |         - count: 1      |
    And no statement carries its bound values

  Scenario: a level outside the list is refused
    Then these requests get these responses:
      | request                             | response                        |
      | method: GET                         | code: 400                       |+
      | path: /audit-probe/transaction-read | body:                           |
      | headers:                            |   errors:                       |
      |   x-query-audit: every              |     - message: >-               |
      |                                     |         Invalid query.          |
      |                                     |         "x-query-audit" must be |
      |                                     |         one of counts,          |
      |                                     |         statements, full.       |

  Scenario: a browser can read the refusal of a level outside the list
    Then these requests get these responses:
      | request                             | response                          |
      | method: GET                         | code: 400                         |+
      | path: /audit-probe/transaction-read | headers:                          |
      | headers:                            |   access-control-allow-origin: >- |
      |   origin: http://example.com        |     http://example.com            |
      |   x-query-audit: every              |                                   |

  Scenario: a savepoint's rollback leaves its transaction open
    Then these requests get these responses:
      | request                               | response                   |
      | method: GET                           | code: 200                  |+
      | path: /audit-probe/savepoint-rollback | headers:                   |
      |                                       |   x-query-audit:           |
      |                                       |     - tables:              |
      |                                       |         directus_users:    |
      |                                       |           select: 1        |
      |                                       |     - outcome: rollback    |
      |                                       |       tables:              |
      |                                       |         directus_settings: |
      |                                       |           select: 3        |

  Scenario: SQL a header cannot carry raw is escaped
    Then these requests get these responses:
      | request                         | response                                    |
      | method: GET                     | code: 200                                   |+
      | path: /audit-probe/accented-sql | headers:                                    |
      |                                 |   x-query-audit:                            |
      |                                 |     - tables:                               |
      |                                 |         directus_users:                     |
      |                                 |           select: 1                         |
      |                                 |     - statements:                           |
      |                                 |         - sql: \|-                          |
      |                                 |             select 'café' as accented_value |
      |                                 |             from directus_settings          |
      |                                 |           count: 1                          |
    And the query audit header holds printable ASCII alone

  Scenario: a bound BigInt reads as its digits
    Then on postgres these requests get these responses:
      | request                           | response                           |
      | method: GET                       | code: 200                          |+
      | path: /audit-probe/bigint-binding | headers:                           |
      | headers:                          |   x-query-audit:                   |
      |   x-query-audit: full             |     - tables:                      |
      |                                   |         directus_users:            |
      |                                   |           select: 1                |
      |                                   |     - statements:                  |
      |                                   |         - sql: >-                  |
      |                                   |             select $1::bigint      |
      |                                   |             as big_value           |
      |                                   |           count: 1                 |
      |                                   |           bindings:                |
      |                                   |             - - "9007199254740993" |

  Scenario: past QUERY_AUDIT_HEADER_MAX_SIZE, details are dropped and counted
    Given an instance whose QUERY_AUDIT_HEADER_MAX_SIZE is 240
    Then these requests get these responses:
      | request                             | response                   |
      | method: GET                         | code: 200                  |+
      | path: /audit-probe/transaction-read | headers:                   |
      | headers:                            |   x-query-audit:           |
      |   x-query-audit: full               |     - tables:              |
      |                                     |         directus_users:    |
      |                                     |           select: 1        |
      |                                     |       bindingsDropped: 1   |
      |                                     |       statementsDropped: 1 |
      |                                     |     - outcome: commit      |
      |                                     |       tables:              |
      |                                     |         directus_settings: |
      |                                     |           select: 2        |
      |                                     |       bindingsDropped: 2   |
      |                                     |       statementsDropped: 1 |

  Scenario: with no detail left to drop, the last entries are dropped and counted
    Then these requests get these responses:
      | request                            | response  |
      | method: GET                        | code: 200 |+
      | path: /audit-probe/many-pool-reads |           |
    And the query audit header fits in 8kb, its last entry counting the entries dropped

  Scenario: an instance with a level outside the list refuses to start
    When an instance starts with QUERY_AUDIT_LEVEL every
    Then it exits naming QUERY_AUDIT_LEVEL and the levels

  Scenario: an instance with a header name Node cannot write refuses to start
    When an instance starts with QUERY_AUDIT_HEADER "x query audit"
    Then it exits naming QUERY_AUDIT_HEADER

  Scenario: two requests at once each report what they report alone
    When these requests run one after the other, then all at once:
      | request                     |
      | method: POST                |+
      | path: /items/audit_articles |
      | payload:                    |
      |   - title: a                |
      | method: GET                 |+
      | path: /items/audit_articles |
    Then each reports the same entries both times

  Scenario: an error response reports the statements it ran
    Then these requests get these responses:
      | request                    | response                |
      | method: GET                | code: 403               |+
      | path: /items/audit_missing | headers:                |
      |                            |   x-query-audit:        |
      |                            |     - tables:           |
      |                            |         directus_users: |
      |                            |           select: 1     |

  Scenario: no header without QUERY_AUDIT_HEADER
    Given the instance without QUERY_AUDIT_HEADER
    Then these requests get these responses:
      | request                    | response              |
      | method: GET                | code: 403             |+
      | path: /items/audit_missing | headers:              |
      |                            |   x-query-audit: null |
