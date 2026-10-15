Feature: A parent's o2m field given as { create, update, delete } alters what it names

  - `create` inserts children of the parent, `update` writes the children it
    names onto the parent, `delete` deselects the parent's children it names:
    their parent nullified, or the child deleted where the relation's deselect
    action is `delete`.
  - On a relation with a sort field, a created child the payload gives no sort
    takes the parent's highest sort plus its index plus one, or its index plus
    one when the parent has no sorted child.
  - Every key is a string the scenario chooses, all of one scenario's keys
    sharing a prefix of its own.
  - A Given creates its table's rows in one request; an empty cell is null.
  - A request authenticates as the admin. A response cell states the keys it
    checks.
  - A Then reads back every row whose key starts with the prefix, sorted by
    key, with the table's columns; a row the table leaves out does not exist.
  - `test_nested_o2m_card` sorts on `sort`; `test_nested_o2m_book` has no sort
    field and keeps the default deselect action; `test_nested_o2m_box_entry`
    deletes.

  Scenario: created children with no sort follow the parent's highest sort
    Given the rows of test_nested_o2m_deck:
      | id   |
      | so-a |
      | so-b |
    And their children in test_nested_o2m_card:
      | id    | deck | sort |
      | so-a1 | so-a | 4    |
      | so-a2 | so-a |      |
      | so-b1 | so-b | 9    |
    When these requests get these responses:
      | request                                | response  |
      | method: PATCH                          | code: 200 |+
      | path: /items/test_nested_o2m_deck/so-a |           |
      | payload:                               |           |
      |   cards:                               |           |
      |     create:                            |           |
      |       - id: so-a3                      |           |
      |       - id: so-a4                      |           |
      |         sort: 2                        |           |
      |       - id: so-a5                      |           |
    Then the rows of test_nested_o2m_card whose key starts with "so-" are:
      | id    | deck | sort |
      | so-a1 | so-a | 4    |
      | so-a2 | so-a |      |
      | so-a3 | so-a | 5    |
      | so-a4 | so-a | 2    |
      | so-a5 | so-a | 7    |
      | so-b1 | so-b | 9    |

  Scenario: a create of several parents numbers each one's children from one
    When these requests get these responses:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_nested_o2m_deck |           |
      | payload:                          |           |
      |   - id: sn-a                      |           |
      |     cards:                        |           |
      |       create:                     |           |
      |         - id: sn-a1               |           |
      |         - id: sn-a2               |           |
      |           sort: 10                |           |
      |         - id: sn-a3               |           |
      |   - id: sn-b                      |           |
      |     cards:                        |           |
      |       create:                     |           |
      |         - id: sn-b1               |           |
    Then the rows of test_nested_o2m_card whose key starts with "sn-" are:
      | id    | deck | sort |
      | sn-a1 | sn-a | 1    |
      | sn-a2 | sn-a | 10   |
      | sn-a3 | sn-a | 3    |
      | sn-b1 | sn-b | 1    |

  Scenario: a highest sort of zero numbers the created children from one
    Given the rows of test_nested_o2m_deck:
      | id   |
      | sz-a |
    And their children in test_nested_o2m_card:
      | id    | deck | sort |
      | sz-a1 | sz-a | 0    |
    When these requests get these responses:
      | request                                | response  |
      | method: PATCH                          | code: 200 |+
      | path: /items/test_nested_o2m_deck/sz-a |           |
      | payload:                               |           |
      |   cards:                               |           |
      |     create:                            |           |
      |       - id: sz-a2                      |           |
      |       - id: sz-a3                      |           |
    Then the rows of test_nested_o2m_card whose key starts with "sz-" are:
      | id    | deck | sort |
      | sz-a1 | sz-a | 0    |
      | sz-a2 | sz-a | 1    |
      | sz-a3 | sz-a | 2    |

  Scenario: children created where the relation has no sort field get only the parent
    When these requests get these responses:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /items/test_nested_o2m_shelf |           |
      | payload:                           |           |
      |   id: ns-a                         |           |
      |   books:                           |           |
      |     create:                        |           |
      |       - id: ns-a1                  |           |
      |         name: first                |           |
      |       - id: ns-a2                  |           |
      |         name: second               |           |
    Then the rows of test_nested_o2m_book whose key starts with "ns-" are:
      | id    | shelf | name   |
      | ns-a1 | ns-a  | first  |
      | ns-a2 | ns-a  | second |

  Scenario: an updated child keeps its parent, and one of another parent moves over
    Given the rows of test_nested_o2m_shelf:
      | id   |
      | up-a |
      | up-b |
    And their children in test_nested_o2m_book:
      | id    | shelf | name |
      | up-a1 | up-a  | old  |
      | up-b1 | up-b  | old  |
    When these requests get these responses:
      | request                                 | response  |
      | method: PATCH                           | code: 200 |+
      | path: /items/test_nested_o2m_shelf/up-a |           |
      | payload:                                |           |
      |   books:                                |           |
      |     update:                             |           |
      |       - id: up-a1                       |           |
      |         name: renamed                   |           |
      |       - id: up-b1                       |           |
      |         name: moved                     |           |
    Then the rows of test_nested_o2m_book whose key starts with "up-" are:
      | id    | shelf | name    |
      | up-a1 | up-a  | renamed |
      | up-b1 | up-a  | moved   |

  Scenario: a deleted child is nullified, one of another parent is left alone
    Given the rows of test_nested_o2m_shelf:
      | id   |
      | dn-a |
      | dn-b |
    And their children in test_nested_o2m_book:
      | id    | shelf |
      | dn-a1 | dn-a  |
      | dn-a2 | dn-a  |
      | dn-b1 | dn-b  |
    When these requests get these responses:
      | request                                 | response  |
      | method: PATCH                           | code: 200 |+
      | path: /items/test_nested_o2m_shelf/dn-a |           |
      | payload:                                |           |
      |   books:                                |           |
      |     delete:                             |           |
      |       - dn-a1                           |           |
      |       - dn-b1                           |           |
    Then the rows of test_nested_o2m_book whose key starts with "dn-" are:
      | id    | shelf |
      | dn-a1 |       |
      | dn-a2 | dn-a  |
      | dn-b1 | dn-b  |

  Scenario: a deleted child is deleted where the relation deletes, another's is kept
    Given the rows of test_nested_o2m_box:
      | id   |
      | dx-a |
      | dx-b |
    And their children in test_nested_o2m_box_entry:
      | id    | box  |
      | dx-a1 | dx-a |
      | dx-a2 | dx-a |
      | dx-b1 | dx-b |
    When these requests get these responses:
      | request                               | response  |
      | method: PATCH                         | code: 200 |+
      | path: /items/test_nested_o2m_box/dx-a |           |
      | payload:                              |           |
      |   entries:                            |           |
      |     delete:                           |           |
      |       - dx-a1                         |           |
      |       - dx-b1                         |           |
    Then the rows of test_nested_o2m_box_entry whose key starts with "dx-" are:
      | id    | box  |
      | dx-a2 | dx-a |
      | dx-b1 | dx-b |

  Scenario: a batch moves a child one parent deletes onto the parent updating it
    Given the rows of test_nested_o2m_shelf:
      | id   |
      | mb-a |
      | mb-b |
    And their children in test_nested_o2m_book:
      | id    | shelf |
      | mb-a1 | mb-a  |
      | mb-b1 | mb-b  |
    When these requests get these responses:
      | request                            | response  |
      | method: PATCH                      | code: 200 |+
      | path: /items/test_nested_o2m_shelf |           |
      | payload:                           |           |
      |   - id: mb-a                       |           |
      |     books:                         |           |
      |       create:                      |           |
      |         - id: mb-a2                |           |
      |       delete:                      |           |
      |         - mb-a1                    |           |
      |   - id: mb-b                       |           |
      |     books:                         |           |
      |       update:                      |           |
      |         - id: mb-a1                |           |
      |           name: moved              |           |
      |       delete:                      |           |
      |         - mb-b1                    |           |
    Then the rows of test_nested_o2m_book whose key starts with "mb-" are:
      | id    | shelf | name  |
      | mb-a1 | mb-b  | moved |
      | mb-a2 | mb-a  |       |
      | mb-b1 |       |       |

  Scenario: an alterations object of the wrong shape is refused, writing nothing
    Given the rows of test_nested_o2m_shelf:
      | id   |
      | iv-a |
    And their children in test_nested_o2m_book:
      | id    | shelf |
      | iv-a1 | iv-a  |
    When these requests get these responses:
      | request                                 | response                    |
      | method: PATCH                           | code: 400                   |+
      | path: /items/test_nested_o2m_shelf/iv-a | body:                       |
      | payload:                                |   errors:                   |
      |   books:                                |     - message: >-           |
      |     create: not-a-list                  |         Invalid payload.    |
      |                                         |         Invalid one-to-many |
      |                                         |         update structure:   |
      |                                         |         "create" must be an |
      |                                         |         array.              |
      |                                         |       extensions:           |
      |                                         |         code:               |
      |                                         |           INVALID_PAYLOAD   |
      | method: PATCH                           | code: 400                   |+
      | path: /items/test_nested_o2m_shelf/iv-a | body:                       |
      | payload:                                |   errors:                   |
      |   books:                                |     - message: >-           |
      |     create: []                          |         Invalid payload.    |
      |     replace:                            |         Invalid one-to-many |
      |       - id: iv-a2                       |         update structure:   |
      |                                         |         "replace" is not    |
      |                                         |         allowed.            |
      |                                         |       extensions:           |
      |                                         |         code:               |
      |                                         |           INVALID_PAYLOAD   |
    Then the rows of test_nested_o2m_book whose key starts with "iv-" are:
      | id    | shelf |
      | iv-a1 | iv-a  |
