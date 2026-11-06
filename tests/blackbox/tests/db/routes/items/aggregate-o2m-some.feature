Feature: An aggregate over an o2m quantifier counts each parent once

  - `test_aggregate_some_article` lists its `test_aggregate_some_link` rows
    through the o2m field `links`.
  - A Given creates its table's rows in one request; an empty cell is null.
  - A request authenticates as the admin. A response cell states the keys it
    checks; every key is a string the scenario chooses, all of one
    scenario's keys sharing a prefix of its own.

  # TODO(#610): `count: "1"` is the string pg returns; sqlite returns the
  # number 1, so every scenario fails on sqlite until the count is normalised
  Scenario: a count filtered by _some counts a parent with two links once
    Given the rows of test_aggregate_some_article:
      | id   |
      | sm-a |
      | sm-b |
    And their children in test_aggregate_some_link:
      | id    | article | name  |
      | sm-a1 | sm-a    | sm    |
      | sm-a2 | sm-a    | sm    |
      | sm-b1 | sm-b    | other |
    When these requests get these responses:
      | request                                  | response         |
      | method: GET                              | code: 200        |+
      | path: /items/test_aggregate_some_article | body:            |
      | query:                                   |   data:          |
      |   aggregate[count]: '*'                  |     - count: "1" |
      |   filter[id][_starts_with]: sm-          |                  |
      |   filter[links][_some][name][_eq]: sm    |                  |

  Scenario: a count filtered by _none counts a parent with two links once
    Given the rows of test_aggregate_some_article:
      | id   |
      | nn-a |
      | nn-b |
    And their children in test_aggregate_some_link:
      | id    | article | name  |
      | nn-a1 | nn-a    | other |
      | nn-a2 | nn-a    | other |
      | nn-b1 | nn-b    | nn    |
    When these requests get these responses:
      | request                                  | response         |
      | method: GET                              | code: 200        |+
      | path: /items/test_aggregate_some_article | body:            |
      | query:                                   |   data:          |
      |   aggregate[count]: '*'                  |     - count: "1" |
      |   filter[id][_starts_with]: nn-          |                  |
      |   filter[links][_none][name][_eq]: nn    |                  |

  Scenario: a count filtered by links.name counts a parent with two links once
    Given the rows of test_aggregate_some_article:
      | id   |
      | im-a |
      | im-b |
    And their children in test_aggregate_some_link:
      | id    | article | name  |
      | im-a1 | im-a    | im    |
      | im-a2 | im-a    | im    |
      | im-b1 | im-b    | other |
    When these requests get these responses:
      | request                                  | response         |
      | method: GET                              | code: 200        |+
      | path: /items/test_aggregate_some_article | body:            |
      | query:                                   |   data:          |
      |   aggregate[count]: '*'                  |     - count: "1" |
      |   filter[id][_starts_with]: im-          |                  |
      |   filter[links][name][_eq]: im           |                  |

  Scenario: two _and conditions on links must hold on the same link
    Given the rows of test_aggregate_some_article:
      | id   |
      | an-a |
    And their children in test_aggregate_some_link:
      | id    | article | name  | status   |
      | an-a1 | an-a    | an    | draft    |
      | an-a2 | an-a    | other | archived |
    When these requests get these responses:
      | request                                         | response         |
      | method: GET                                     | code: 200        |+
      | path: /items/test_aggregate_some_article        | body:            |
      | query:                                          |   data:          |
      |   aggregate[count]: '*'                         |     - count: "0" |
      |   filter[id][_starts_with]: an-                 |                  |
      |   filter[_and][0][links][name][_eq]: an         |                  |
      |   filter[_and][1][links][status][_eq]: archived |                  |
