Feature: A write casts each field by its special, and reads it back cast

  - A request cell is YAML: `method`, `path`, `query`, `payload`, `token`. A
    list under `query` is sent joined by commas. A request authenticates as the
    admin, or as the user whose static token `token` names: `TestsFlowToken` is
    an admin user of its own role.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_write_cast_row` is keyed by strings the scenarios choose: `flag` is a
    cast-boolean, `notes` a cast-json text, `tags` a cast-csv, `role_created`
    and `role_updated` record a role, `day` is a date and `moment` a dateTime.
  - `test_write_cast_activity` logs activity but keeps no revisions.
  - `test_write_cast_single` is a singleton nothing writes: `motto` defaults to
    `hello`, `visits` has no default.

  Scenario: a boolean holding null reads as null
    When these requests get these responses:
      | request                          | response        |
      | method: POST                     | code: 200       |+
      | path: /items/test_write_cast_row | body:           |
      | payload:                         |   data:         |
      |   id: wc-flag                    |     id: wc-flag |
      |                                  |     flag: null  |

  Scenario: a cast-json text holding no JSON reads as the text it holds
    When these requests get these responses:
      | request                          | response            |
      | method: POST                     | code: 200           |+
      | path: /items/test_write_cast_row | body:               |
      | payload:                         |   data:             |
      |   id: wc-notes                   |     notes: not json |
      |   notes: not json                |                     |

  Scenario: a cast-csv written as a text or a list reads as a list
    When these requests get these responses:
      | request                          | response     |
      | method: POST                     | code: 200    |+
      | path: /items/test_write_cast_row | body:        |
      | payload:                         |   data:      |
      |   id: wc-csv-text                |     tags:    |
      |   tags: a,b                      |       - a    |
      |                                  |       - b    |
      | method: POST                     | code: 200    |+
      | path: /items/test_write_cast_row | body:        |
      | payload:                         |   data:      |
      |   id: wc-csv-list                |     tags:    |
      |   tags:                          |       - c    |
      |     - c                          |       - d    |
      |     - d                          |              |
      | method: POST                     | code: 200    |+
      | path: /items/test_write_cast_row | body:        |
      | payload:                         |   data:      |
      |   id: wc-csv-empty               |     tags: [] |
      |   tags: ''                       |              |

  Scenario: the role fields record the role of the user who created and updated
    When these requests get these responses:
      | request                                    | response          |
      | method: POST                               | code: 200         |+
      | path: /items/test_write_cast_row           |                   |
      | token: TestsFlowToken                      |                   |
      | payload:                                   |                   |
      |   id: wc-role                              |                   |
      | method: PATCH                              | code: 200         |+
      | path: /items/test_write_cast_row/wc-role   |                   |
      | token: TestsFlowToken                      |                   |
      | payload:                                   |                   |
      |   flag: true                               |                   |
      | method: GET                                | code: 200         |+
      | path: /items/test_write_cast_row           | body:             |
      | token: TestsFlowToken                      |   data:           |
      | query:                                     |     - id: wc-role |
      |   filter[id][_eq]: wc-role                 |                   |
      |   filter[role_created][_eq]: $CURRENT_ROLE |                   |
      |   filter[role_updated][_eq]: $CURRENT_ROLE |                   |
      |   fields: id                               |                   |

  Scenario: a date that does not parse is refused
    When these requests get these responses:
      | request                          | response  |
      | method: POST                     | code: 400 |+
      | path: /items/test_write_cast_row |           |
      | payload:                         |           |
      |   id: wc-day                     |           |
      |   day: not a date                |           |
    Then response 1 is refused with the message:
      """
      Invalid payload. Invalid Date format in field "day".
      """

  Scenario: a dateTime that does not parse is refused
    When these requests get these responses:
      | request                          | response  |
      | method: POST                     | code: 400 |+
      | path: /items/test_write_cast_row |           |
      | payload:                         |           |
      |   id: wc-moment                  |           |
      |   moment: not a date             |           |
    Then response 1 is refused with the message:
      """
      Invalid payload. Invalid DateTime format in field "moment".
      """

  Scenario: a collection logging activity only writes no revision on create or update
    When these requests get these responses:
      | request                                             | response          |
      | method: POST                                        | code: 200         |+
      | path: /items/test_write_cast_activity               |                   |
      | payload:                                            |                   |
      |   id: wc-activity                                   |                   |
      |   name: created                                     |                   |
      | method: PATCH                                       | code: 200         |+
      | path: /items/test_write_cast_activity/wc-activity   | body:             |
      | payload:                                            |   data:           |
      |   name: updated                                     |     name: updated |
      | method: GET                                         | code: 200         |+
      | path: /revisions                                    | body:             |
      | query:                                              |   data: []        |
      |   filter[collection][_eq]: test_write_cast_activity |                   |

  Scenario: a batch update of an empty list updates nothing
    When these requests get these responses:
      | request                          | response   |
      | method: PATCH                    | code: 200  |+
      | path: /items/test_write_cast_row | body:      |
      | payload: []                      |   data: [] |

  Scenario: a singleton never written reads as its defaults, its key null
    When these requests get these responses:
      | request                             | response         |
      | method: GET                         | code: 200        |+
      | path: /items/test_write_cast_single | body:            |
      |                                     |   data:          |
      |                                     |     id: null     |
      |                                     |     motto: hello |
      | method: GET                         | code: 200        |+
      | path: /items/test_write_cast_single | body:            |
      | query:                              |   data:          |
      |   fields: motto                     |     motto: hello |
      | method: GET                         | code: 200        |+
      | path: /items/test_write_cast_single | body:            |
      | query:                              |   data:          |
      |   fields: '*'                       |     id: null     |
      |                                     |     motto: hello |
