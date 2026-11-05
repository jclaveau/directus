Feature: A count under an o2m read permission counts each parent once

  - `test_aggregate_perm_article` lists its `test_aggregate_perm_link` rows
    through the o2m field `links`, and points at its `test_aggregate_perm_author`
    through the m2o field `author`.
  - A grouped count returns `category: null` for a row its reader may not see
    the category of.
  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a count under an o2m read permission counts a parent once
    Given these requests are sent:
      | request                                       | response  |
      | method: POST                                  | code: 200 |+
      | path: /items/test_aggregate_perm_article      |           |
      | payload:                                      |           |
      |   - id: <run>-a                               |           |
      |   - id: <run>-b                               |           |
      | method: POST                                  | code: 200 |+
      | path: /items/test_aggregate_perm_link         |           |
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
      |     - collection: test_aggregate_perm_article |           |
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
      | path: /items/test_aggregate_perm_article |   data:          |
      | query:                                   |     - count: "1" |
      |   aggregate[count]: '*'                  |                  |
      |   filter[id][_starts_with]: <run>-       |                  |

  Scenario: a search count under an o2m read permission counts a parent once
    Given these requests are sent:
      | request                                       | response  |
      | method: POST                                  | code: 200 |+
      | path: /items/test_aggregate_perm_article      |           |
      | payload:                                      |           |
      |   - id: <run>-a                               |           |
      |   - id: <run>-b                               |           |
      | method: POST                                  | code: 200 |+
      | path: /items/test_aggregate_perm_link         |           |
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
      |     - collection: test_aggregate_perm_article |           |
      |       action: read                            |           |
      |       fields:                                 |           |
      |         - id                                  |           |
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
      | path: /items/test_aggregate_perm_article |   data:          |
      | query:                                   |     - count: "1" |
      |   aggregate[count]: '*'                  |                  |
      |   search: <run>-                         |                  |

  Scenario: a count grouped by a field granted through an m2o, filtered through an o2m
    Given the rows of test_aggregate_perm_author:
      | id        | status    |
      | <run>-pub | published |
      | <run>-dft | draft     |
    And their children in test_aggregate_perm_article:
      | id      | category | author    |
      | <run>-a | news     | <run>-pub |
      | <run>-b | news     | <run>-pub |
      | <run>-c | sport    | <run>-pub |
      | <run>-d | secret   | <run>-dft |
      | <run>-e | news     | <run>-pub |
      | <run>-f | news     | <run>-pub |
      | <run>-g | secret   |           |
    And their grandchildren in test_aggregate_perm_link:
      | id       | article | name  |
      | <run>-a1 | <run>-a | pm    |
      | <run>-a2 | <run>-a | pm    |
      | <run>-b1 | <run>-b | pm    |
      | <run>-c1 | <run>-c | pm    |
      | <run>-d1 | <run>-d | pm    |
      | <run>-e1 | <run>-e | other |
      | <run>-g1 | <run>-g | pm    |
    And a user whose token is <reader-token> may read:
      | collection                  | fields   | permissions                          |
      | test_aggregate_perm_article | id,links | {}                                   |
      | test_aggregate_perm_article | category | {author: {status: {_eq: published}}} |
      | test_aggregate_perm_link    | name     | {}                                   |
    Then these requests get these responses:
      | request                                  | response              |
      | as: <reader-token>                       | code: 200             |+
      | method: GET                              | body:                 |
      | path: /items/test_aggregate_perm_article |   data:               |
      | query:                                   |     - category: news  |
      |   aggregate[count]: '*'                  |       count: "2"      |
      |   groupBy: category                      |     - category: sport |
      |   filter[id][_starts_with]: <run>-       |       count: "1"      |
      |   filter[links][name][_eq]: pm           |     - category: null  |
      |                                          |       count: "2"      |
      | as: <reader-token>                       | code: 200             |+
      | method: GET                              | body:                 |
      | path: /items/test_aggregate_perm_article |   data:               |
      | query:                                   |     - category: news  |
      |   aggregate[count]: '*'                  |       count: "4"      |
      |   groupBy: category                      |     - category: sport |
      |   filter[id][_starts_with]: <run>-       |       count: "1"      |
      |                                          |     - category: null  |
      |                                          |       count: "2"      |
      | as: <reader-token>                       | code: 200             |+
      | method: GET                              | body:                 |
      | path: /items/test_aggregate_perm_article |   data:               |
      | query:                                   |     - category: news  |
      |   aggregate[count]: '*'                  |       count: "1"      |
      |   groupBy: category                      |                       |
      |   search: <run>-a                        |                       |
      |   filter[links][name][_eq]: pm           |                       |

  Scenario: a count grouped by a field granted through an o2m, filtered through that o2m
    Given the rows of test_aggregate_perm_article:
      | id      | category |
      | <run>-a | news     |
      | <run>-b | news     |
      | <run>-c | sport    |
      | <run>-d | secret   |
      | <run>-e | news     |
      | <run>-f | news     |
    And their children in test_aggregate_perm_link:
      | id       | article | name  |
      | <run>-a1 | <run>-a | pm    |
      | <run>-a2 | <run>-a | pm    |
      | <run>-a3 | <run>-a | other |
      | <run>-b1 | <run>-b | pm    |
      | <run>-c1 | <run>-c | pm    |
      | <run>-d1 | <run>-d | im    |
      | <run>-e1 | <run>-e | other |
    And a user whose token is <reader-token> may read:
      | collection                  | fields   | permissions                |
      | test_aggregate_perm_article | id,links | {}                         |
      | test_aggregate_perm_article | category | {links: {name: {_eq: pm}}} |
      | test_aggregate_perm_link    | name     | {}                         |
    Then these requests get these responses:
      | request                                  | response              |
      | as: <reader-token>                       | code: 200             |+
      | method: GET                              | body:                 |
      | path: /items/test_aggregate_perm_article |   data:               |
      | query:                                   |     - category: news  |
      |   aggregate[count]: '*'                  |       count: "2"      |
      |   groupBy: category                      |     - category: sport |
      |   filter[id][_starts_with]: <run>-       |       count: "1"      |
      |   filter[links][name][_in]: pm,im        |     - category: null  |
      |                                          |       count: "1"      |
      | as: <reader-token>                       | code: 200             |+
      | method: GET                              | body:                 |
      | path: /items/test_aggregate_perm_article |   data:               |
      | query:                                   |     - category: news  |
      |   aggregate[count]: '*'                  |       count: "2"      |
      |   groupBy: category                      |     - category: sport |
      |   filter[id][_starts_with]: <run>-       |       count: "1"      |
      |                                          |     - category: null  |
      |                                          |       count: "3"      |
      | as: <reader-token>                       | code: 200             |+
      | method: GET                              | body:                 |
      | path: /items/test_aggregate_perm_article |   data:               |
      | query:                                   |     - id: <run>-a     |
      |   aggregate[count]: '*'                  |       category: news  |
      |   groupBy: id,category                   |       count: "1"      |
      |   filter[id][_starts_with]: <run>-       |     - id: <run>-b     |
      |                                          |       category: news  |
      |                                          |       count: "1"      |
      |                                          |     - id: <run>-c     |
      |                                          |       category: sport |
      |                                          |       count: "1"      |
      |                                          |     - id: <run>-d     |
      |                                          |       category: null  |
      |                                          |       count: "1"      |
      |                                          |     - id: <run>-e     |
      |                                          |       category: null  |
      |                                          |       count: "1"      |
      |                                          |     - id: <run>-f     |
      |                                          |       category: null  |
      |                                          |       count: "1"      |
      | as: <reader-token>                       | code: 200             |+
      | method: GET                              | body:                 |
      | path: /items/test_aggregate_perm_article |   data:               |
      | query:                                   |     - category: news  |
      |   aggregate[count]: '*'                  |       count: "1"      |
      |   groupBy: category                      |                       |
      |   search: <run>-a                        |                       |

  Scenario: a field granted through two conditions on an o2m needs one child to meet both
    Given the rows of test_aggregate_perm_article:
      | id      | category |
      | <run>-a | news     |
      | <run>-b | news     |
      | <run>-c | news     |
    And their children in test_aggregate_perm_link:
      | id       | article | name  | status |
      | <run>-a1 | <run>-a | pm    | live   |
      | <run>-b1 | <run>-b | pm    | draft  |
      | <run>-b2 | <run>-b | other | live   |
      | <run>-c1 | <run>-c | other | draft  |
    And a user whose token is <reader-token> may read:
      | collection                  | fields   | permissions   |
      | test_aggregate_perm_article | id,links | {}            |+
      | test_aggregate_perm_article | category | links:        |+
      |                             |          |   name:       |
      |                             |          |     _eq: pm   |
      |                             |          |   status:     |
      |                             |          |     _eq: live |
    Then these requests get these responses:
      | request                                  | response             |
      | as: <reader-token>                       | code: 200            |+
      | method: GET                              | body:                |
      | path: /items/test_aggregate_perm_article |   data:              |
      | query:                                   |     - category: news |
      |   aggregate[count]: '*'                  |       count: "1"     |
      |   groupBy: category                      |     - category: null |
      |   filter[id][_starts_with]: <run>-       |       count: "2"     |

  Scenario: a field granted through an o2m or through an m2o counts a parent once
    Given the rows of test_aggregate_perm_author:
      | id        | status    |
      | <run>-pub | published |
      | <run>-dft | draft     |
    And their children in test_aggregate_perm_article:
      | id      | category | author    |
      | <run>-a | news     | <run>-dft |
      | <run>-b | news     | <run>-pub |
      | <run>-c | news     | <run>-pub |
      | <run>-d | secret   | <run>-dft |
      | <run>-e | secret   |           |
    And their grandchildren in test_aggregate_perm_link:
      | id       | article | name  |
      | <run>-a1 | <run>-a | pm    |
      | <run>-a2 | <run>-a | pm    |
      | <run>-b1 | <run>-b | other |
      | <run>-c1 | <run>-c | pm    |
      | <run>-d1 | <run>-d | other |
    And a user whose token is <reader-token> may read:
      | collection                  | fields   | permissions                          |
      | test_aggregate_perm_article | id,links | {}                                   |
      | test_aggregate_perm_article | category | {links: {name: {_eq: pm}}}           |
      | test_aggregate_perm_article | category | {author: {status: {_eq: published}}} |
    Then these requests get these responses:
      | request                                  | response             |
      | as: <reader-token>                       | code: 200            |+
      | method: GET                              | body:                |
      | path: /items/test_aggregate_perm_article |   data:              |
      | query:                                   |     - category: news |
      |   aggregate[count]: '*'                  |       count: "3"     |
      |   groupBy: category                      |     - category: null |
      |   filter[id][_starts_with]: <run>-       |       count: "2"     |
