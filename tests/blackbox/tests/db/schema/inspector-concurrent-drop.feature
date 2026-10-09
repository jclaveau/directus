Feature: The schema inspector reads a table another connection drops meanwhile

  Sibling test files drop their collections on the shared database while an
  instance introspects it, as `GET /fields` does on a cold schema cache. A
  statement lists the catalog rows of its snapshot, so a table dropped after
  the snapshot is still listed: reading its columns answers that snapshot
  rather than failing the read.

  A repeatable-read transaction holds the snapshot across the drop, the way a
  single statement does when the drop commits while it runs.

  Scenario: the columns of a table dropped after the snapshot are still read
    Given a table with a serial primary key and a text column
    And a repeatable-read transaction took its snapshot
    And another connection dropped the table
    When the inspector reads the table's columns in the transaction
    Then it answers:
      | name  | is_primary_key | has_auto_increment |
      | id    | true           | true               |
      | label | false          | false              |
