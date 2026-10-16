Feature: A single extension is updated and deleted by its key

  - A request authenticates as the admin. `<name>` stands for a uuid of its
    own. A response cell states the keys it checks.
  - The key is one no extension holds, so neither request touches what the
    instance has loaded.

  Scenario: an extension update without its meta is refused
    Then these requests get these responses:
      | request                     | response                           |
      | method: PATCH               | code: 400                          |+
      | path: /extensions/<missing> | body:                              |
      | payload:                    |   errors:                          |
      |   enabled: false            |     - message: >-                  |
      |                             |         Invalid payload. "meta" is |
      |                             |         required.                  |

  Scenario: deleting an extension by a key no extension holds answers with no content
    Then these requests get these responses:
      | request                     | response  |
      | method: DELETE              | code: 204 |+
      | path: /extensions/<missing> |           |
