Feature: A translation moves to another key or language only onto a free one

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: a translation moved by its key and language at once lands on a free pair only
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
      |   key: taken-<run>  |           |
      |   language: de-DE   |           |
      |   value: hallo      |           |
    Then these requests get these responses:
      | request                        | response                      |
      | method: PATCH                  | code: 200                     |+
      | path: /translations/<greeting> | body:                         |
      | query:                         |   data:                       |
      |   fields: key,language         |     key: moved-<run>          |
      | payload:                       |     language: fr-FR           |
      |   key: moved-<run>             |                               |
      |   language: fr-FR              |                               |
      | method: PATCH                  | code: 400                     |+
      | path: /translations/<greeting> | body:                         |
      | payload:                       |   errors:                     |
      |   key: taken-<run>             |     - message: >-             |
      |   language: de-DE              |         Invalid payload.      |
      |                                |         Duplicate key and     |
      |                                |         language combination. |
      | method: GET                    | code: 200                     |+
      | path: /translations/<greeting> | body:                         |
      | query:                         |   data:                       |
      |   fields: key,language         |     key: moved-<run>          |
      |                                |     language: fr-FR           |

  Scenario: one key and language given to several translations is refused
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
      |   id: <farewell>    |           |
      |   key: tm-<run>     |           |
      |   language: fr-FR   |           |
      |   value: au revoir  |           |
    Then these requests get these responses:
      | request                | response                      |
      | method: PATCH          | code: 400                     |+
      | path: /translations    | body:                         |
      | payload:               |   errors:                     |
      |   keys:                |     - message: >-             |
      |     - <greeting>       |         Invalid payload.      |
      |     - <farewell>       |         Duplicate key and     |
      |   data:                |         language combination. |
      |     key: moved-<run>   |                               |
      |     language: de-DE    |                               |
      | method: GET            | code: 200                     |+
      | path: /translations    | body:                         |
      | query:                 |   data:                       |
      |   fields: key,language |     - key: tm-<run>           |
      |   sort: language       |       language: en-US         |
      |   filter:              |     - key: tm-<run>           |
      |     key:               |       language: fr-FR         |
      |       _eq: tm-<run>    |                               |

  Scenario: two translations for one key and language created at once are refused
    Then these requests get these responses:
      | request             | response                            |
      | method: POST        | code: 400                           |+
      | path: /translations | body:                               |
      | payload:            |   errors:                           |
      |   - key: tm-<run>   |     - message: >-                   |
      |     language: en-US |         Value for field "key,       |
      |     value: hello    |         language" in collection     |
      |   - key: tm-<run>   |         "directus_translations" has |
      |     language: en-US |         to be unique.               |
      |     value: hi       |                                     |
      | method: GET         | code: 200                           |+
      | path: /translations | body:                               |
      | query:              |   data: []                          |
      |   fields: key       |                                     |
      |   filter:           |                                     |
      |     key:            |                                     |
      |       _eq: tm-<run> |                                     |

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
