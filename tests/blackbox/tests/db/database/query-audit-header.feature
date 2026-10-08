Feature: A request reports the SQL it ran, one entry per transaction

  - The instance: QUERY_AUDIT_HEADER `x-query-audit`, QUERY_AUDIT_LEVEL
    `statements`, QUERY_AUDIT_TIMINGS `false`, CORS on.
  - A request authenticates as the admin unless its headers say otherwise.
  - A response states the keys it checks; `x-query-audit` reads parsed.
  - Every header starts with its `request:` entry, then the read that
    authenticates it, outside any transaction.
  - At `counts`, `stmt` is `<kind> <table>...`; at the other levels, the SQL.

  Scenario: a create reports its transaction and the reads around it
    Then on postgres these requests get these responses:
      | request                     | response                                   |
      | method: POST                | code: 200                                  |+
      | path: /items/audit_articles | headers:                                   |
      | headers:                    |   x-query-audit:                           |
      |   x-query-audit: counts     |     - request:                             |
      | payload:                    |         maxConnections: 1                  |
      |   - title: a                |     - stmt: select directus_users...       |
      |   - title: b                |     - transaction: commit                  |
      |   - title: c                |       statements:                          |
      |                             |       - stmt: insert audit_articles...     |
      |                             |         rows: 3                            |
      |                             |       - stmt: insert directus_activity...  |
      |                             |       - stmt: insert directus_revisions... |
      |                             |     - stmt: select audit_articles...       |

  Scenario: a pool read inside a transaction holds a second connection
    Then except on sqlite3, these requests get these responses:
      | request                      | response                                  |
      | method: GET                  | code: 200                                 |+
      | path: /audit-probe/pool-read | headers:                                  |
      | headers:                     |   x-query-audit:                          |
      |   x-query-audit: counts      |     - request:                            |
      |                              |         maxConnections: 2                 |
      |                              |     - stmt: select directus_users...      |
      |                              |     - transaction: commit                 |
      |                              |       statements:                         |
      |                              |       - stmt: select directus_settings... |
      |                              |     - stmt: select directus_settings...   |

  Scenario: reads through the transaction share its connection and its entry
    Then these requests get these responses:
      | request                             | response                                  |
      | method: GET                         | code: 200                                 |+
      | path: /audit-probe/transaction-read | headers:                                  |
      | headers:                            |   x-query-audit:                          |
      |   x-query-audit: counts             |     - request:                            |
      |                                     |         maxConnections: 1                 |
      |                                     |     - stmt: select directus_users...      |
      |                                     |     - transaction: commit                 |
      |                                     |       statements:                         |
      |                                     |       - stmt: select directus_settings... |
      |                                     |         count: 2                          |
      |                                     |         rows: 2                           |
    And on postgres these requests get these responses:
      | request                             | response                              |
      | method: GET                         | code: 200                             |+
      | path: /audit-probe/transaction-read | headers:                              |
      |                                     |   x-query-audit:                      |
      |                                     |     - request:                        |
      |                                     |         maxConnections: 1             |
      |                                     |     - stmt: >-                        |
      |                                     |         select "directus_users"."id", |
      |                                     |         "directus_users"."role"       |
      |                                     |         from "directus_users"         |
      |                                     |         where                         |
      |                                     |         "directus_users"."token" = $1 |
      |                                     |         and "status" = $2 limit $3    |
      |                                     |     - transaction: commit             |
      |                                     |       statements:                     |
      |                                     |       - stmt: >-                      |
      |                                     |           select "id"                 |
      |                                     |           from "directus_settings"    |
      |                                     |           where "id" = $1             |
      |                                     |         count: 2                      |

  Scenario: an update matching no row reports it changed none
    Then these requests get these responses:
      | request                           | response                             |
      | method: GET                       | code: 200                            |+
      | path: /audit-probe/update-nothing | headers:                             |
      | headers:                          |   x-query-audit:                     |
      |   x-query-audit: counts           |     - request:                       |
      |                                   |         maxConnections: 1            |
      |                                   |     - stmt: select directus_users... |
      |                                   |     - stmt: update audit_articles... |
      |                                   |       rows: 0                        |

  Scenario: a failed statement reports its code, its transaction rolled back
    Then on postgres these requests get these responses:
      | request                             | response                               |
      | method: GET                         | code: 500                              |+
      | path: /audit-probe/duplicate-insert | headers:                               |
      | headers:                            |   x-query-audit:                       |
      |   x-query-audit: counts             |     - request:                         |
      |                                     |         maxConnections: 1              |
      |                                     |     - stmt: select directus_users...   |
      |                                     |     - transaction: rollback            |
      |                                     |       statements:                      |
      |                                     |       - stmt: insert audit_articles... |
      |                                     |         error: '23505'                 |

  Scenario: an admin asking bindings gets each run's bound values
    Then on postgres these requests get these responses:
      | request                             | response                              |
      | method: GET                         | code: 200                             |+
      | path: /audit-probe/transaction-read | headers:                              |
      | headers:                            |   x-query-audit:                      |
      |   x-query-audit: bindings           |     - request:                        |
      |                                     |         maxConnections: 1             |
      |                                     |     - stmt: >-                        |
      |                                     |         select "directus_users"."id", |
      |                                     |         "directus_users"."role"       |
      |                                     |         from "directus_users"         |
      |                                     |         where                         |
      |                                     |         "directus_users"."token" = $1 |
      |                                     |         and "status" = $2 limit $3    |
      |                                     |       bindings:                       |
      |                                     |         - - AdminToken                |
      |                                     |           - active                    |
      |                                     |           - 1                         |
      |                                     |     - transaction: commit             |
      |                                     |       statements:                     |
      |                                     |       - stmt: >-                      |
      |                                     |           select "id"                 |
      |                                     |           from "directus_settings"    |
      |                                     |           where "id" = $1             |
      |                                     |         count: 2                      |
      |                                     |         bindings:                     |
      |                                     |           - - 1                       |
      |                                     |           - - 1                       |

  Scenario: an admin asking full gets every run in order, each with its values
    Then on postgres these requests get these responses:
      | request                             | response                              |
      | method: GET                         | code: 200                             |+
      | path: /audit-probe/transaction-read | headers:                              |
      | headers:                            |   x-query-audit:                      |
      |   x-query-audit: full               |     - request:                        |
      |                                     |         maxConnections: 1             |
      |                                     |     - stmt: >-                        |
      |                                     |         select "directus_users"."id", |
      |                                     |         "directus_users"."role"       |
      |                                     |         from "directus_users"         |
      |                                     |         where                         |
      |                                     |         "directus_users"."token" = $1 |
      |                                     |         and "status" = $2 limit $3    |
      |                                     |       bindings:                       |
      |                                     |         - AdminToken                  |
      |                                     |         - active                      |
      |                                     |         - 1                           |
      |                                     |     - transaction: commit             |
      |                                     |       statements:                     |
      |                                     |       - stmt: >-                      |
      |                                     |           select "id"                 |
      |                                     |           from "directus_settings"    |
      |                                     |           where "id" = $1             |
      |                                     |         bindings:                     |
      |                                     |           - 1                         |
      |                                     |       - stmt: >-                      |
      |                                     |           select "id"                 |
      |                                     |           from "directus_settings"    |
      |                                     |           where "id" = $1             |
      |                                     |         bindings:                     |
      |                                     |           - 1                         |

  Scenario: anyone else asking full gets the statements alone
    Then these requests get these responses:
      | request                             | response  |
      | method: GET                         | code: 403 |+
      | path: /audit-probe/transaction-read |           |
      | headers:                            |           |
      |   authorization: >-                 |           |
      |     Bearer <app access token>       |           |
      |   x-query-audit: full               |           |
    And the token's lookup reports its SQL alone

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
      |                                     |         statements, bindings,   |
      |                                     |         full.                   |

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
      | request                           | response                                  |
      | method: GET                       | code: 200                                 |+
      | path: /audit-probe/savepoint-undo | headers:                                  |
      | headers:                          |   x-query-audit:                          |
      |   x-query-audit: counts           |     - request:                            |
      |                                   |         maxConnections: 1                 |
      |                                   |     - stmt: select directus_users...      |
      |                                   |     - transaction: rollback               |
      |                                   |       statements:                         |
      |                                   |       - stmt: select directus_settings... |
      |                                   |         count: 3                          |

  Scenario: SQL a header cannot carry raw is escaped
    Then on postgres these requests get these responses:
      | request                         | response                                |
      | method: GET                     | code: 200                               |+
      | path: /audit-probe/accented-sql | headers:                                |
      |                                 |   x-query-audit:                        |
      |                                 |     - request:                          |
      |                                 |         maxConnections: 1               |
      |                                 |     - stmt: >-                          |
      |                                 |         select "directus_users"."id",   |
      |                                 |         "directus_users"."role"         |
      |                                 |         from "directus_users"           |
      |                                 |         where                           |
      |                                 |         "directus_users"."token" = $1   |
      |                                 |         and "status" = $2 limit $3      |
      |                                 |     - stmt: \|-                         |
      |                                 |         select 'café' as accented_value |
      |                                 |         from directus_settings          |
    And the query audit header holds printable ASCII alone

  Scenario: a bound BigInt reads as its digits
    Then on postgres these requests get these responses:
      | request                           | response                              |
      | method: GET                       | code: 200                             |+
      | path: /audit-probe/bigint-binding | headers:                              |
      | headers:                          |   x-query-audit:                      |
      |   x-query-audit: bindings         |     - request:                        |
      |                                   |         maxConnections: 1             |
      |                                   |     - stmt: >-                        |
      |                                   |         select "directus_users"."id", |
      |                                   |         "directus_users"."role"       |
      |                                   |         from "directus_users"         |
      |                                   |         where                         |
      |                                   |         "directus_users"."token" = $1 |
      |                                   |         and "status" = $2 limit $3    |
      |                                   |     - stmt: >-                        |
      |                                   |         select $1::bigint             |
      |                                   |         as big_value                  |
      |                                   |       bindings:                       |
      |                                   |         - - "9007199254740993"        |

  Scenario: past QUERY_AUDIT_HEADER_MAX_SIZE, details are dropped and counted
    Given an instance whose QUERY_AUDIT_HEADER_MAX_SIZE is 280
    Then on postgres these requests get these responses:
      | request                             | response                             |
      | method: GET                         | code: 200                            |+
      | path: /audit-probe/transaction-read | headers:                             |
      | headers:                            |   x-query-audit:                     |
      |   x-query-audit: bindings           |     - request:                       |
      |                                     |         maxConnections: 1            |
      |                                     |     - stmt: select directus_users... |
      |                                     |       rows: 1                        |
      |                                     |       bindingsDropped: 1             |
      |                                     |       statementsCut: 1               |
      |                                     |     - transaction: commit            |
      |                                     |       statements:                    |
      |                                     |       - stmt: >-                     |
      |                                     |           select "id"                |
      |                                     |           from "directus_settings"   |
      |                                     |           where "id" = $1            |
      |                                     |         count: 2                     |
      |                                     |         rows: 2                      |
      |                                     |       bindingsDropped: 2             |

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
      | request                    | response                             |
      | method: GET                | code: 403                            |+
      | path: /items/audit_missing | headers:                             |
      | headers:                   |   x-query-audit:                     |
      |   x-query-audit: counts    |     - request:                       |
      |                            |         maxConnections: 1            |
      |                            |     - stmt: select directus_users... |

  Scenario: no header without QUERY_AUDIT_HEADER
    Given the instance without QUERY_AUDIT_HEADER
    Then these requests get these responses:
      | request                    | response              |
      | method: GET                | code: 403             |+
      | path: /items/audit_missing | headers:              |
      |                            |   x-query-audit: null |
