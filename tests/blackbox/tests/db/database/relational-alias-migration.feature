Feature: The migration deletes the relational aliases no relation names

  - A relational alias (special o2m, m2m, m2a, translations or files) no
    directus_relations row names in one_collection and one_field is read as a
    column, and every read of its collection then answers 500 (#381).
  - The migration is run again with `directus database migrate:latest`, its
    version row deleted first.

  Scenario: an o2m alias no relation names is deleted, a named one is kept
    Given the rows of directus_fields:
      | collection        | field        | special |
      | migration_owner   | loose_items  | o2m     |
      | migration_owner   | owned_items  | o2m     |
    And the rows of directus_relations:
      | many_collection | many_field | one_collection  | one_field   |
      | migration_item  | owner      | migration_owner | owned_items |
    When the migration deleting the unnamed relational aliases is run again
    Then directus_fields holds for migration_owner:
      | field       |
      | owned_items |
