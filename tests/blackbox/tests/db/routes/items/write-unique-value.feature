Feature: A single row refused as a duplicate names the value it repeats

  - A request cell is YAML: `method`, `path`, `payload`. A request
    authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks.
  - `test_write_unique_code` is keyed by integers; its `code` is unique.

  Scenario: a second row of one code is refused naming that code
    When these requests get these responses:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /items/test_write_unique_code |           |
      | payload:                            |           |
      |   code: repeated                    |           |
      | method: POST                        | code: 400 |+
      | path: /items/test_write_unique_code |           |
      | payload:                            |           |
      |   code: repeated                    |           |
    Then response 2 is refused with the message:
      """
      Value "repeated" for field "code" in collection "test_write_unique_code" has to be
      unique.
      """
