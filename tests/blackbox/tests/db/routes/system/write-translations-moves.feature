Feature: A translation moves to another key or language only onto a free one

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: a translation moved by its key and its language at once is refused
    Given these requests are sent:
      | request             | response  |
      | method: POST        | code: 200 |+
      | path: /translations |           |
      | payload:            |           |
      |   id: <greeting>    |           |
      |   key: tm-<run>     |           |
      |   language: en-US   |           |
      |   value: hello      |           |
    Then these requests get these responses:
      | request                        | response                      |
      | method: PATCH                  | code: 400                     |+
      | path: /translations/<greeting> | body:                         |
      | payload:                       |   errors:                     |
      |   key: moved-<run>             |     - message: >-             |
      |   language: fr-FR              |         Invalid payload.      |
      |                                |         Duplicate key and     |
      |                                |         language combination. |
      | method: GET                    | code: 200                     |+
      | path: /translations/<greeting> | body:                         |
      | query:                         |   data:                       |
      |   fields: key,language         |     key: tm-<run>             |
      |                                |     language: en-US           |

  Scenario: a translation moved by its language alone lands on a free one only
    Given these requests are sent:
      | request             | response  |
      | method: POST        | code: 200 |+
      | path: /translations |           |
      | payload:            |           |
      |   id: <greeting>    |           |
      |   key: tm-<run>     |           |
      |   language: en-US   |           |
      |   value: hello      |           |
      | method: POST        | code: 200 |+
      | path: /translations |           |
      | payload:            |           |
      |   key: tm-<run>     |           |
      |   language: fr-FR   |           |
      |   value: bonjour    |           |
    Then these requests get these responses:
      | request                        | response                      |
      | method: PATCH                  | code: 200                     |+
      | path: /translations/<greeting> | body:                         |
      | query:                         |   data:                       |
      |   fields: key,language         |     key: tm-<run>             |
      | payload:                       |     language: de-DE           |
      |   language: de-DE              |                               |
      | method: PATCH                  | code: 400                     |+
      | path: /translations/<greeting> | body:                         |
      | payload:                       |   errors:                     |
      |   language: fr-FR              |     - message: >-             |
      |                                |         Invalid payload.      |
      |                                |         Duplicate key and     |
      |                                |         language combination. |
      | method: GET                    | code: 200                     |+
      | path: /translations/<greeting> | body:                         |
      | query:                         |   data:                       |
      |   fields: language             |     language: de-DE           |

  Scenario: a batch naming no keys moves no translation
    Given these requests are sent:
      | request             | response  |
      | method: POST        | code: 200 |+
      | path: /translations |           |
      | payload:            |           |
      |   id: <greeting>    |           |
      |   key: tm-<run>     |           |
      |   language: en-US   |           |
      |   value: hello      |           |
    Then these requests get these responses:
      | request                        | response            |
      | method: PATCH                  | code: 200           |+
      | path: /translations            | body:               |
      | payload:                       |   data: []          |
      |   keys: []                     |                     |
      |   data:                        |                     |
      |     key: moved-<run>           |                     |
      |     language: fr-FR            |                     |
      | method: GET                    | code: 200           |+
      | path: /translations/<greeting> | body:               |
      | query:                         |   data:             |
      |   fields: key,language         |     key: tm-<run>   |
      |                                |     language: en-US |
