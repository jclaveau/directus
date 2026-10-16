Feature: A row keyed 0 is written, with its children, though its key is falsy

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list under
    `query` is sent joined by commas. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_write_zero_parent` is keyed by integers and only ever holds row 0. Its
    one-to-many fields `listed`, `sorted` and `plain` reach the string-keyed
    `test_write_zero_listed`, `test_write_zero_sorted` (sorted by `position`)
    and `test_write_zero_plain` through their `parent`.
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
