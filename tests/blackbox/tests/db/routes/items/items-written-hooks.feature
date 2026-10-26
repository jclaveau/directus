Feature: A created or updated hook runs once the rows are written, before the commit

  An `items.created` or `items.updated` filter hook is handed the rows a create
  or an update wrote, inside its transaction: it reads them back through
  `context.transaction`, a write it makes there commits with the mutation, and
  a hook that throws takes the mutation back. The items-written-hooks hook
  reads each row it is handed back and notes `<event>:<status>:<children>` in
  the witness collection, the count of child rows pointing at it, then throws on
  the status "refuse" and answers other rows on the status "answer", so a
  refused mutation must take that note back with it. Every
  scenario owns its item collection, `<name>_item`, with the children of its
  `children` field in `<name>_child`, and its `<name>_witness` collection.

  Scenario: a create hands the created hook the row it wrote
    Given the collections of test_items_written_create
    When the item 1 is created with the status "draft"
    Then the mutation answers 200
    And the witness of the item 1 holds the notes "created:draft:0"

  Scenario: a create hands the created hook its nested children already written
    Given the collections of test_items_written_nested
    When the item 1 is created with the status "draft" and 2 children
    Then the mutation answers 200
    And the witness of the item 1 holds the notes "created:draft:2"

  Scenario: a created hook that throws takes the create back
    Given the collections of test_items_written_create_refused
    When the item 1 is created with the status "refuse"
    Then the mutation is refused with the status 500 and the message:
      """
      The created hook refused the row 1
      """
    And the item 1 does not exist
    And the witness of the item 1 holds no note

  Scenario: a created hook answering other rows is refused
    Given the collections of test_items_written_create_answered
    When the item 1 is created with the status "answer"
    Then the mutation is refused with the status 400 and the message:
      """
      Invalid payload. A "items.created" filter hook must return nothing or the
      rows it received: they are already written.
      """
    And the item 1 does not exist
    And the witness of the item 1 holds no note

  Scenario: an update hands the updated hook the row it wrote
    Given the collections of test_items_written_update
    And the item 1 with the status "draft"
    When the item 1 is updated to the status "archived"
    Then the mutation answers 200
    And the witness of the item 1 holds the notes "created:draft:0, updated:archived:0"

  Scenario: an updated hook that throws takes the update back
    Given the collections of test_items_written_update_refused
    And the item 1 with the status "draft"
    When the item 1 is updated to the status "refuse"
    Then the mutation is refused with the status 500 and the message:
      """
      The updated hook refused the row 1
      """
    And the item 1 holds the status "draft"
    And the witness of the item 1 holds the notes "created:draft:0"
