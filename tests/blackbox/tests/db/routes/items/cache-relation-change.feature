Feature: A relation change flushes the response cache

  A collection's scoped index is split by a path walked through its M2O
  relations, so creating, retargeting or dropping one can move where a read is
  filed while its entries stay under the old sets, which a later purge no longer
  reads. A relation change flushes the response cache, as a collection or field
  change already does.

  Here a slot's `zone` starts as a plain integer, and a read of the slots is
  cached before it becomes a relation to the zones.

  Scenario: creating a relation flushes the reads cached before it
    Given the slots:
      | note  |
      | first |
    And this read of the slots is cached:
      | query    | response      |
      | fields:  | - note: first |+
      |   - note |               |
    When the slots' zone becomes a relation to the zones
    Then the read is filled again, the relation having flushed it:
      | query    | response      |
      | fields:  | - note: first |+
      |   - note |               |
