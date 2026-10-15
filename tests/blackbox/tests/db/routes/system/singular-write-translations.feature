Feature: A single translation is checked as it is created and deleted

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own, or for the key
    a `remember: name` row stored. A response cell states the keys it checks.

  Scenario: a second translation of one key and language is refused
    Given these requests are sent:
      | request             | response  |
      | method: POST        | code: 200 |+
      | path: /translations |           |
      | payload:            |           |
      |   key: sw-<run>     |           |
      |   language: en-US   |           |
      |   value: first      |           |
    Then these requests get these responses:
      | request                      | response                      |
      | method: POST                 | code: 400                     |+
      | path: /translations          | body:                         |
      | payload:                     |   errors:                     |
      |   key: sw-<run>              |     - message: >-             |
      |   language: en-US            |         Invalid payload.      |
      |   value: second              |         Duplicate key and     |
      |                              |         language combination. |
      | method: GET                  | code: 200                     |+
      | path: /translations          | body:                         |
      | query:                       |   data:                       |
      |   fields: language,value     |     - language: en-US         |
      |   filter[key][_eq]: sw-<run> |       value: first            |
      | method: POST                 | code: 200                     |+
      | path: /translations          | body:                         |
      | payload:                     |   data:                       |
      |   key: sw-<run>              |     key: sw-<run>             |
      |   language: fr-FR            |     language: fr-FR           |
      |   value: second              |     value: second             |

  Scenario: a translation deleted by its key is gone
    Given these requests are sent:
      | request             | response  |
      | method: POST        | code: 200 |+
      | path: /translations |           |
      | payload:            |           |
      |   id: <greeting>    |           |
      |   key: sw-<run>     |           |
      |   language: en-US   |           |
      |   value: hello      |           |
    Then these requests get these responses:
      | request                        | response   |
      | method: DELETE                 | code: 204  |+
      | path: /translations/<greeting> |            |
      | method: GET                    | code: 200  |+
      | path: /translations            | body:      |
      | query:                         |   data: [] |
      |   fields: id                   |            |
      |   filter[key][_eq]: sw-<run>   |            |

  Scenario: deleting a translation by a key that is no uuid is refused
    Then these requests get these responses:
      | request                       | response                         |
      | method: DELETE                | code: 400                        |+
      | path: /translations/not-a-key | body:                            |
      |                               |   errors:                        |
      |                               |     - message: >-                |
      |                               |         Invalid payload. Primary |
      |                               |         key of                   |
      |                               |         directus_translations    |
      |                               |         must be a uuid instead   |
      |                               |         of "not-a-key".          |
