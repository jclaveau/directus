Feature: A count under an o2m read permission counts each parent once

  - `test_aggregate_some_article` lists its `test_aggregate_some_link` rows
    through the o2m field `links`.
  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a count under an o2m read permission counts a parent once
    Given these requests are sent:
      | request                                       | response  |
      | method: POST                                  | code: 200 |+
      | path: /items/test_aggregate_some_article      |           |
      | payload:                                      |           |
      |   - id: <run>-a                               |           |
      |   - id: <run>-b                               |           |
      | method: POST                                  | code: 200 |+
      | path: /items/test_aggregate_some_link         |           |
      | payload:                                      |           |
      |   - id: <run>-a1                              |           |
      |     article: <run>-a                          |           |
      |     name: pm                                  |           |
      |   - id: <run>-a2                              |           |
      |     article: <run>-a                          |           |
      |     name: pm                                  |           |
      |   - id: <run>-b1                              |           |
      |     article: <run>-b                          |           |
      |     name: other                               |           |
      | method: POST                                  | code: 200 |+
      | path: /policies                               |           |
      | payload:                                      |           |
      |   id: <count-policy>                          |           |
      |   name: ag-count-<run>                        |           |
      |   app_access: false                           |           |
      |   admin_access: false                         |           |
      |   permissions:                                |           |
      |     - collection: test_aggregate_some_article |           |
      |       action: read                            |           |
      |       fields:                                 |           |
      |         - '*'                                 |           |
      |       permissions:                            |           |
      |         links:                                |           |
      |           name:                               |           |
      |             _eq: pm                           |           |
      | method: POST                                  | code: 200 |+
      | path: /users                                  |           |
      | payload:                                      |           |
      |   email: ag-<run>@example.com                 |           |
      |   token: <reader-token>                       |           |
      |   policies:                                   |           |
      |     - policy: <count-policy>                  |           |
    Then these requests get these responses:
      | request                                  | response         |
      | as: <reader-token>                       | code: 200        |+
      | method: GET                              | body:            |
      | path: /items/test_aggregate_some_article |   data:          |
      | query:                                   |     - count: "1" |
      |   aggregate[count]: '*'                  |                  |
      |   filter[id][_starts_with]: <run>-       |                  |
