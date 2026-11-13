Feature: A relation change that rolled back leaves the response cache warm

  A relation change flushes the response cache: the scoped index is split by a
  path walked through relations, and a purge after the change would read sets no
  fill was filed in. The flush ran in the `finally`, so a change the database
  refused flushed too, though it moved nothing.

  Here the foreign key cannot be added: a row already points at a parent that
  does not exist.

  Scenario: a relation the database refuses does not flush the cached reads
    Given this row of relation_rollback_child:
      | parent |
      | 999    |
    And this read is cached:
      | response        |
      | [{parent: 999}] |
    When a relation from parent to relation_rollback_parent is refused
    Then this read answers:
      | cache | response        |
      | HIT   | [{parent: 999}] |
