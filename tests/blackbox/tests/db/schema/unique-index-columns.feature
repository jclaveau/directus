Feature: The schema overview flags the columns of a unique index a foreign key can name

  An upsert writing such a column reads its rows FOR UPDATE, else FOR NO KEY
  UPDATE. A foreign key can name only a unique index with no predicate and no
  expression, and the primary key never counts: it is not written by an
  upsert updating its row.

  Scenario: only the columns of a plain unique index are flagged
    Given a table with:
      """
      id serial primary key,
      plain text unique,
      first_part text,
      second_part text,
      partial text,
      archived boolean,
      tenant text,
      label text,
      unique (first_part, second_part)
      """
    And the unique indexes:
      """
      create unique index on unique_index_columns (partial) where archived = false;
      create unique index on unique_index_columns (tenant, lower(label));
      """
    When the overview of the schema is read
    Then the table's columns answer:
      | column      | in_unique_index |
      | id          |                 |
      | plain       | true            |
      | first_part  | true            |
      | second_part | true            |
      | partial     |                 |
      | archived    |                 |
      | tenant      |                 |
      | label       |                 |
