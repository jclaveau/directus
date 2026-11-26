Feature: The database refuses a relational alias no relation names

  - A relational alias (special o2m, m2m, m2a, translations or files) no
    directus_relations row names in one_collection and one_field is read as a
    column, and every read of its collection then answers 500 (#381).
  - directus_fields holds the alias name in the generated column relation_alias,
    and the deferred foreign key directus_fields_relation_alias_foreign refuses
    at commit a row no relation names. Postgres only (#610).

  Scenario: A — an o2m alias inserted by SQL with no relation naming it is refused
    Given the rows of directus_relations:
      | many_collection | many_field | one_collection | one_field |
      | fk_owned_item   | owner      | fk_owner       |           |
    When this SQL is run:
      | sql                                                           |
      | insert into directus_fields (collection, field, special)      |
      | values ('fk_owner', 'owned_items', 'o2m')                     |
    Then the commit fails naming directus_fields_relation_alias_foreign
    And directus_fields holds for fk_owner:
      | field |
