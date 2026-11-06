Feature: A nested write reaching back into the collection it starts from

  - A parent's o2m array upserts its children in one batch. A child nesting
    rows, pointing a self relation at a row, or setting an o2m alias, is
    written on its own, in array order: a batch writes its updates before its
    creates, so the row it or its nested rows point at would not exist yet,
    and of two children naming one row by key the first would keep it.
  - Every key is a string the scenario chooses, all of one scenario's keys
    sharing a prefix of its own.
  - A Given creates its table's rows in one request; an empty cell is null.
  - A request authenticates as the admin. A response cell states the keys it
    checks.
  - A Then reads back every row whose key starts with the prefix, sorted by
    key, with the table's columns; a row the table leaves out does not exist.
  - `test_nested_cycle_node` relates to itself: `children` lists the rows
    whose `parent` it is, and `link` points at any other node.
    `test_nested_cycle_owner` lists its `test_nested_cycle_entry` rows in
    `entries`; an entry's `ref` points at a `test_nested_cycle_ref` row, whose
    `entry` points back at an entry. An entry lists its
    `test_nested_cycle_note` rows in `notes`.
  - Every relation holds a foreign key.

  Scenario: a child updates the row a child before it created as its nested child
    Given the rows of test_nested_cycle_node:
      | id    |
      | cs-1  |
      | cs-10 |
    When these requests get these responses:
      | request                                   | response  |
      | method: PATCH                             | code: 200 |+
      | path: /items/test_nested_cycle_node/cs-1  |           |
      | payload:                                  |           |
      |   children:                               |           |
      |     - id: cs-10                           |           |
      |       children:                           |           |
      |         - id: cs-11                       |           |
      |           name: a                         |           |
      |     - id: cs-11                           |           |
      |       name: y                             |           |
    Then the rows of test_nested_cycle_node whose key starts with "cs-" are:
      | id    | name | parent |
      | cs-1  |      |        |
      | cs-10 |      | cs-1   |
      | cs-11 | y    | cs-1   |

  Scenario: a child links to a child created before it
    Given the rows of test_nested_cycle_node:
      | id   |
      | cl-1 |
    And their children in test_nested_cycle_node:
      | id    | parent |
      | cl-10 | cl-1   |
    When these requests get these responses:
      | request                                   | response  |
      | method: PATCH                             | code: 200 |+
      | path: /items/test_nested_cycle_node/cl-1  |           |
      | payload:                                  |           |
      |   children:                               |           |
      |     - id: cl-20                           |           |
      |       name: new                           |           |
      |     - id: cl-10                           |           |
      |       link: cl-20                         |           |
    Then the rows of test_nested_cycle_node whose key starts with "cl-" are:
      | id    | name | parent | link  |
      | cl-1  |      |        |       |
      | cl-10 |      | cl-1   | cl-20 |
      | cl-20 | new  | cl-1   |       |

  Scenario: a child nests a row pointing back at a child created before it
    Given the rows of test_nested_cycle_owner:
      | id   |
      | cr-o |
    And their children in test_nested_cycle_entry:
      | id    | owner |
      | cr-10 | cr-o  |
    When these requests get these responses:
      | request                                   | response  |
      | method: PATCH                             | code: 200 |+
      | path: /items/test_nested_cycle_owner/cr-o |           |
      | payload:                                  |           |
      |   entries:                                |           |
      |     - id: cr-50                           |           |
      |       name: new                           |           |
      |     - id: cr-10                           |           |
      |       ref:                                |           |
      |         id: cr-90                         |           |
      |         entry: cr-50                      |           |
    Then the rows of test_nested_cycle_entry whose key starts with "cr-" are:
      | id    | name | owner | ref   |
      | cr-10 |      | cr-o  | cr-90 |
      | cr-50 | new  | cr-o  |       |

  Scenario: the last of two children naming one row by key gets it
    Given the rows of test_nested_cycle_owner:
      | id   |
      | cn-o |
    And their children in test_nested_cycle_entry:
      | id   | owner |
      | cn-2 | cn-o  |
    When these requests get these responses:
      | request                                   | response  |
      | method: POST                              | code: 200 |+
      | path: /items/test_nested_cycle_note       |           |
      | payload:                                  |           |
      |   id: cn-9                                |           |
      | method: PATCH                             | code: 200 |+
      | path: /items/test_nested_cycle_owner/cn-o |           |
      | payload:                                  |           |
      |   entries:                                |           |
      |     - id: cn-3                            |           |
      |       notes: [cn-9]                       |           |
      |     - id: cn-2                            |           |
      |       notes: [cn-9]                       |           |
    Then the rows of test_nested_cycle_note whose key starts with "cn-" are:
      | id   | entry |
      | cn-9 | cn-2  |
