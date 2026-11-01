Feature: A row keyed 0 is written, with its children, though its key is falsy

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list under
    `query` is sent joined by commas. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_write_zero_parent` is keyed by integers and only ever holds row 0. Its
    one-to-many fields `listed`, `sorted` and `plain` reach the string-keyed
    `test_write_zero_listed`, `test_write_zero_sorted` (sorted by `position`)
    and `test_write_zero_plain` through their `parent`.
  - `test_write_zero_counted` is keyed by integers and has a `name`.
  - `test_write_zero_holder` lists `test_write_zero_member` rows through their
    `holder`; both are keyed by integers.
  - A database that generates a key when given 0 writes another row instead.

  Scenario: a row keyed 0 created with its children is their parent
    When these requests get these responses:
      | request                                        | response        |
      | method: POST                                   | code: 200       |+
      | path: /items/test_write_zero_parent            | body:           |
      | payload:                                       |   data:         |
      |   id: 0                                        |     id: 0       |
      |   listed:                                      |                 |
      |     - id: zl-created                           |                 |
      |   sorted:                                      |                 |
      |     create:                                    |                 |
      |       - id: zs-created                         |                 |
      |   plain:                                       |                 |
      |     create:                                    |                 |
      |       - id: zp-created                         |                 |
      | method: GET                                    | code: 200       |+
      | path: /items/test_write_zero_listed/zl-created | body:           |
      |                                                |   data:         |
      |                                                |     parent: 0   |
      | method: GET                                    | code: 200       |+
      | path: /items/test_write_zero_sorted/zs-created | body:           |
      |                                                |   data:         |
      |                                                |     parent: 0   |
      |                                                |     position: 1 |
      | method: GET                                    | code: 200       |+
      | path: /items/test_write_zero_plain/zp-created  | body:           |
      |                                                |   data:         |
      |                                                |     parent: 0   |

  Scenario: a row keyed 0 updated with its children adopts them
    When these requests get these responses:
      | request                                        | response        |
      | method: POST                                   | code: 200       |+
      | path: /items/test_write_zero_sorted            |                 |
      | payload:                                       |                 |
      |   id: zs-adopted                               |                 |
      | method: PATCH                                  | code: 200       |+
      | path: /items/test_write_zero_parent/0          |                 |
      | payload:                                       |                 |
      |   id: 0                                        |                 |
      |   listed:                                      |                 |
      |     - id: zl-updated                           |                 |
      |   sorted:                                      |                 |
      |     update:                                    |                 |
      |       - id: zs-adopted                         |                 |
      |         position: 7                            |                 |
      | method: GET                                    | code: 200       |+
      | path: /items/test_write_zero_listed/zl-updated | body:           |
      |                                                |   data:         |
      |                                                |     parent: 0   |
      | method: GET                                    | code: 200       |+
      | path: /items/test_write_zero_sorted/zs-adopted | body:           |
      |                                                |   data:         |
      |                                                |     parent: 0   |
      |                                                |     position: 7 |

  Scenario: a row keyed 0 created beside a higher key answers with its own row
    When these requests get these responses:
      | request                              | response       |
      | method: POST                         | code: 200      |+
      | path: /items/test_write_zero_counted | body:          |
      | payload:                             |   data:        |
      |   id: 5                              |     id: 5      |
      |   name: five                         |     name: five |
      | method: POST                         | code: 200      |+
      | path: /items/test_write_zero_counted | body:          |
      | payload:                             |   data:        |
      |   id: 0                              |     id: 0      |
      |   name: zero                         |     name: zero |

  Scenario: a row keyed 0 updated by its keys adopts the children it creates
    When these requests get these responses:
      | request                                       | response      |
      | method: PATCH                                 | code: 200     |+
      | path: /items/test_write_zero_parent           |               |
      | payload:                                      |               |
      |   keys: [0]                                   |               |
      |   data:                                       |               |
      |     plain:                                    |               |
      |       create:                                 |               |
      |         - id: zp-by-keys                      |               |
      | method: GET                                   | code: 200     |+
      | path: /items/test_write_zero_plain/zp-by-keys | body:         |
      |                                               |   data:       |
      |                                               |     parent: 0 |

  Scenario: a row keyed 0 updated in a list of rows adopts the children it creates
    When these requests get these responses:
      | request                                       | response      |
      | method: PATCH                                 | code: 200     |+
      | path: /items/test_write_zero_parent           |               |
      | payload:                                      |               |
      |   - id: 0                                     |               |
      |     plain:                                    |               |
      |       create:                                 |               |
      |         - id: zp-in-list                      |               |
      | method: GET                                   | code: 200     |+
      | path: /items/test_write_zero_plain/zp-in-list | body:         |
      |                                               |   data:       |
      |                                               |     parent: 0 |

  Scenario: a child keyed 0 linked by its key is adopted, not created again
    When these requests get these responses:
      | request                               | response      |
      | method: POST                          | code: 200     |+
      | path: /items/test_write_zero_member   |               |
      | payload:                              |               |
      |   id: 0                               |               |
      | method: POST                          | code: 200     |+
      | path: /items/test_write_zero_holder   |               |
      | payload:                              |               |
      |   id: 1                               |               |
      | method: PATCH                         | code: 200     |+
      | path: /items/test_write_zero_holder/1 |               |
      | payload:                              |               |
      |   members: [0]                        |               |
      | method: GET                           | code: 200     |+
      | path: /items/test_write_zero_member/0 | body:         |
      |                                       |   data:       |
      |                                       |     holder: 1 |
