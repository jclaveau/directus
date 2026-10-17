Feature: A write checks what its filter hooks answer before writing it

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list under
    `query` is sent joined by commas. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_write_answer_row` is keyed by integers the scenarios choose; its
    `owner` is a many-to-one to `test_write_answer_owner`, whose `rows` deletes
    the rows it leaves out. Neither keeps revisions.
  - The `write-answers-probe` hook answers the filters of `test_write_answer_row`:
    the create filter by a row's `name`, the update filter by a group's
    `status`, and the delete filter answers null when it deletes row 108.
  - `test_write_answer_ledger` keeps revisions; its update filter writes amount
    9007199254740993 as a BigInt for a group whose status is
    `answer-big-number`.

  Scenario: a create filter answering null cancels a single create, which returns null
    When these requests get these responses:
      | request                            | response     |
      | method: POST                       | code: 200    |+
      | path: /items/test_write_answer_row | body:        |
      | payload:                           |   data: null |
      |   id: 111                          |              |
      |   name: answer-null                |              |
      | method: GET                        | code: 200    |+
      | path: /items/test_write_answer_row | body:        |
      | query:                             |   data: []   |
      |   filter[id][_eq]: 111             |              |

  Scenario: a create filter cancelling a nested create is refused, writing nothing
    When these requests get these responses:
      | request                              | response   |
      | method: POST                         | code: 400  |+
      | path: /items/test_write_answer_owner |            |
      | payload:                             |            |
      |   id: ao-cancel                      |            |
      |   rows:                              |            |
      |     create:                          |            |
      |       - id: 104                      |            |
      |         name: answer-null            |            |
      | method: GET                          | code: 200  |+
      | path: /items/test_write_answer_owner | body:      |
      | query:                               |   data: [] |
      |   filter[id][_eq]: ao-cancel         |            |
    Then response 1 is refused with the message:
      """
      Invalid payload. A filter hook cancelled the creation, but this operation
      requires a created item.
      """

  Scenario: a create filter deleting an entry off its list is refused
    When these requests get these responses:
      | request                            | response  |
      | method: POST                       | code: 400 |+
      | path: /items/test_write_answer_row |           |
      | payload:                           |           |
      |   id: 112                          |           |
      |   name: answer-hole                |           |
    Then response 1 is refused with the message:
      """
      Invalid payload. A "items.create" filter hook must return one { data } |
      { key } | { sameRowAs } | null per row it received, a sameRowAs pointing at
      an earlier row; a hook that handles one row maps them with mapCreateRows.
      """

  Scenario: a create filter answering a row both as data and as a key is refused
    When these requests get these responses:
      | request                            | response  |
      | method: POST                       | code: 400 |+
      | path: /items/test_write_answer_row |           |
      | payload:                           |           |
      |   id: 114                          |           |
      |   name: answer-twice               |           |
    Then response 1 is refused with the message:
      """
      Invalid payload. A "items.create" filter hook must return one { data } |
      { key } | { sameRowAs } | null per row it received, a sameRowAs pointing at
      an earlier row; a hook that handles one row maps them with mapCreateRows.
      """

  Scenario: a create filter replacing an entry by its index writes the entry it set
    When these requests get these responses:
      | request                            | response              |
      | method: POST                       | code: 200             |+
      | path: /items/test_write_answer_row | body:                 |
      | payload:                           |   data:               |
      |   id: 113                          |     id: 113           |
      |   name: answer-overwrite           |     name: overwritten |

  Scenario: an update filter answering null cancels a batch update, which returns no item
    When these requests get these responses:
      | request                                | response          |
      | method: POST                           | code: 200         |+
      | path: /items/test_write_answer_row     |                   |
      | payload:                               |                   |
      |   id: 106                              |                   |
      |   status: start                        |                   |
      | method: PATCH                          | code: 200         |+
      | path: /items/test_write_answer_row     | body:             |
      | payload:                               |   data: []        |
      |   keys:                                |                   |
      |     - 106                              |                   |
      |   data:                                |                   |
      |     status: answer-null                |                   |
      | method: GET                            | code: 200         |+
      | path: /items/test_write_answer_row/106 | body:             |
      |                                        |   data:           |
      |                                        |     status: start |

  Scenario: an update filter cancelling a nested update is refused
    When these requests get these responses:
      | request                                      | response          |
      | method: POST                                 | code: 200         |+
      | path: /items/test_write_answer_owner         |                   |
      | payload:                                     |                   |
      |   id: ao-null                                |                   |
      |   rows:                                      |                   |
      |     - id: 102                                |                   |
      |       status: start                          |                   |
      | method: PATCH                                | code: 400         |+
      | path: /items/test_write_answer_owner/ao-null |                   |
      | payload:                                     |                   |
      |   rows:                                      |                   |
      |     update:                                  |                   |
      |       - id: 102                              |                   |
      |         status: answer-null                  |                   |
      | method: GET                                  | code: 200         |+
      | path: /items/test_write_answer_row/102       | body:             |
      |                                              |   data:           |
      |                                              |     status: start |
    Then response 2 is refused with the message:
      """
      Invalid payload. A filter hook cancelled the update, but this operation
      requires it.
      """

  Scenario: an update filter dropping a row of a nested update is refused
    When these requests get these responses:
      | request                                      | response  |
      | method: POST                                 | code: 200 |+
      | path: /items/test_write_answer_owner         |           |
      | payload:                                     |           |
      |   id: ao-drop                                |           |
      |   rows:                                      |           |
      |     - id: 103                                |           |
      |       status: start                          |           |
      | method: PATCH                                | code: 400 |+
      | path: /items/test_write_answer_owner/ao-drop |           |
      | payload:                                     |           |
      |   rows:                                      |           |
      |     update:                                  |           |
      |       - id: 103                              |           |
      |         status: answer-drop-key              |           |
    Then response 2 is refused with the message:
      """
      Invalid payload. A filter hook cancelled a row of the update, but this
      operation requires it.
      """

  Scenario: an update filter adding a key of the wrong type is refused
    When these requests get these responses:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /items/test_write_answer_row     |           |
      | payload:                               |           |
      |   id: 110                              |           |
      |   status: start                        |           |
      | method: PATCH                          | code: 400 |+
      | path: /items/test_write_answer_row/110 |           |
      | payload:                               |           |
      |   status: answer-bad-key               |           |
    Then response 2 is refused with the message:
      """
      Invalid payload. Primary key of test_write_answer_row must be an integer
      instead of "not-a-number".
      """

  Scenario: an update filter answering a row in a group and as a key is refused
    When these requests get these responses:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /items/test_write_answer_row     |           |
      | payload:                               |           |
      |   id: 105                              |           |
      |   status: start                        |           |
      | method: PATCH                          | code: 400 |+
      | path: /items/test_write_answer_row/105 |           |
      | payload:                               |           |
      |   status: answer-both-ways             |           |
    Then response 2 is refused with the message:
      """
      Invalid payload. A "items.update" filter hook took row 105 over as { key }
      but also left it in a { data, keys } group; answer each row one way.
      """

  Scenario: an update filter adding a row to a nested upsert writes that row too
    When these requests get these responses:
      | request                                     | response                     |
      | method: POST                                | code: 200                    |+
      | path: /items/test_write_answer_row          |                              |
      | payload:                                    |                              |
      |   id: 109                                   |                              |
      |   status: start                             |                              |
      | method: POST                                | code: 200                    |+
      | path: /items/test_write_answer_owner        |                              |
      | payload:                                    |                              |
      |   id: ao-add                                |                              |
      |   rows:                                     |                              |
      |     - id: 101                               |                              |
      |       status: start                         |                              |
      | method: PATCH                               | code: 200                    |+
      | path: /items/test_write_answer_owner/ao-add |                              |
      | payload:                                    |                              |
      |   rows:                                     |                              |
      |     - id: 101                               |                              |
      |       status: answer-add-row                |                              |
      | method: GET                                 | code: 200                    |+
      | path: /items/test_write_answer_row          | body:                        |
      | query:                                      |   data:                      |
      |   filter[id][_in]:                          |     - id: 101                |
      |     - 101                                   |       status: answer-add-row |
      |     - 109                                   |       owner: ao-add          |
      |   fields:                                   |     - id: 109                |
      |     - id                                    |       status: answer-add-row |
      |     - status                                |       owner: null            |
      |     - owner                                 |                              |
      |   sort: id                                  |                              |

  Scenario: an update filter writing a BigInt writes it as the number it holds
    When these requests get these responses:
      | request                                | response                      |
      | method: POST                           | code: 200                     |+
      | path: /items/test_write_answer_row     |                               |
      | payload:                               |                               |
      |   id: 107                              |                               |
      |   status: start                        |                               |
      |   amount: 1                            |                               |
      | method: PATCH                          | code: 200                     |+
      | path: /items/test_write_answer_row/107 | body:                         |
      | payload:                               |   data:                       |
      |   status: answer-big-number            |     id: 107                   |
      |                                        |     status: answer-big-number |
      |                                        |     amount: 7                 |

  Scenario: an update filter writing a BigInt keeps it in the revision as a string
    When these requests get these responses:
      | request                                   | response                           |
      | method: POST                              | code: 200                          |+
      | path: /items/test_write_answer_ledger     |                                    |
      | payload:                                  |                                    |
      |   id: 201                                 |                                    |
      |   status: start                           |                                    |
      | method: PATCH                             | code: 200                          |+
      | path: /items/test_write_answer_ledger/201 |                                    |
      | payload:                                  |                                    |
      |   status: answer-big-number               |                                    |
      | method: GET                               | code: 200                          |+
      | path: /revisions                          | body:                              |
      | query:                                    |   data:                            |
      |   filter[collection][_eq]: >-             |     - delta:                       |
      |     test_write_answer_ledger              |         status: answer-big-number  |
      |   filter[item][_eq]: 201                  |         amount: "9007199254740993" |
      |   filter[activity][action][_eq]: update   |                                    |
      |   fields: delta                           |                                    |

  Scenario: a delete filter cancelling a nested delete is refused, keeping the row
    When these requests get these responses:
      | request                                     | response          |
      | method: POST                                | code: 200         |+
      | path: /items/test_write_answer_owner        |                   |
      | payload:                                    |                   |
      |   id: ao-del                                |                   |
      |   rows:                                     |                   |
      |     - id: 108                               |                   |
      |       status: start                         |                   |
      | method: PATCH                               | code: 400         |+
      | path: /items/test_write_answer_owner/ao-del |                   |
      | payload:                                    |                   |
      |   rows:                                     |                   |
      |     delete:                                 |                   |
      |       - 108                                 |                   |
      | method: GET                                 | code: 200         |+
      | path: /items/test_write_answer_row/108      | body:             |
      |                                             |   data:           |
      |                                             |     owner: ao-del |
    Then response 2 is refused with the message:
      """
      Invalid payload. A filter hook cancelled the deletion, but this operation
      requires it.
      """
