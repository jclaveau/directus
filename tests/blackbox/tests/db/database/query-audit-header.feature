Feature: A request reports the SQL it ran, one entry per transaction

  QUERY_AUDIT_HEADER names a response header listing, in the order they began,
  the transactions the request ran. An entry maps each table to the statements
  of each kind it received, and says whether it committed or rolled back. A
  statement sent outside a transaction is an entry of its own, the way the
  database runs it; BEGIN, COMMIT and SAVEPOINT are not listed.
  A request picks how much by sending the same header: `counts` lists the
  tables alone, `statements` adds each entry's statements: the SQL the driver
  received, placeholders in place of the bound values, once per distinct text;
  `full` adds each run's bound values, for an admin alone. QUERY_AUDIT_LEVEL is
  the level of a request that sends none, `statements` on this instance.

  Durations vary from run to run: the steps check each `ms` is a number, then
  read the rest as the YAML below, in its key order. The probe routes read
  `directus_settings` twice inside one transaction: the pool route sends the
  second read through the pool, the transaction route through the transaction.
  Every request authenticates first, which reads `directus_users` outside any
  transaction.

  Scenario: a create reports its transaction and the reads around it
    When three articles are created
    Then on postgres the header reads:
      """
      - tables: { directus_users: { select: 1 } }
      - outcome: commit
        tables:
          query_audit_header_articles: { insert: 1 }
          directus_activity: { insert: 1 }
          directus_revisions: { insert: 1 }
      - tables: { query_audit_header_articles: { select: 1 } }
      """

  Scenario: a pool read inside a transaction is an entry of its own
    When the pool route is requested
    Then the header reads, except on sqlite3:
      """
      - tables: { directus_users: { select: 1 } }
      - outcome: commit
        tables: { directus_settings: { select: 1 } }
      - tables: { directus_settings: { select: 1 } }
      """

  Scenario: reads through the transaction share its entry
    When the transaction route is requested
    Then the header reads:
      """
      - tables: { directus_users: { select: 1 } }
      - outcome: commit
        tables: { directus_settings: { select: 2 } }
      """
    And on postgres the transaction's statements read:
      """
      - sql: select "id" from "directus_settings" where "id" = $1
        count: 2
      """

  Scenario: an admin asking full gets each run's bound values
    When the transaction route is requested at the full level
    Then on postgres the transaction's statements read:
      """
      - sql: select "id" from "directus_settings" where "id" = $1
        count: 2
        bindings: [[1], [1]]
      """

  Scenario: anyone else asking full gets the statements alone
    When a user who is no admin requests the transaction route at the full level
    Then the response is a 403 whose header lists statements without bound values

  Scenario: a level outside the list is refused
    When the transaction route is requested at the every level
    Then the response is a 400 naming the levels

  Scenario: a savepoint's rollback leaves its transaction open
    When the savepoint route is requested
    Then the header reads:
      """
      - tables: { directus_users: { select: 1 } }
      - outcome: rollback
        tables: { directus_settings: { select: 3 } }
      """

  Scenario: SQL a header cannot carry raw is escaped
    When the accented multi-line route is requested
    Then the header holds printable ASCII alone
    And the second entry's statements read:
      """
      - sql: "select 'café' as accented_value\nfrom directus_settings"
        count: 1
      """

  Scenario: past QUERY_AUDIT_HEADER_MAX_SIZE, details are dropped and counted
    When an instance capped at 10 bytes serves the transaction route at full
    Then the header reads, durations aside:
      """
      - tables: { directus_users: { select: 1 } }
        bindingsDropped: 1
        statementsDropped: 1
      - outcome: commit
        tables: { directus_settings: { select: 2 } }
        bindingsDropped: 2
        statementsDropped: 1
      """

  Scenario: an instance with a level outside the list refuses to start
    When an instance starts with QUERY_AUDIT_LEVEL every
    Then it exits naming QUERY_AUDIT_LEVEL and the levels

  Scenario: two requests at once each report what they report alone
    When a create and a read run one after the other, then both at once
    Then each reports the same entries both times

  Scenario: an error response reports the statements it ran
    When a missing collection is read
    Then the response is a 403 whose header reads:
      """
      - tables: { directus_users: { select: 1 } }
      """

  Scenario: no header without QUERY_AUDIT_HEADER
    When the collection is read from an instance without QUERY_AUDIT_HEADER
    Then the response carries no query audit header
