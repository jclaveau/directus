Feature: The conditions under an o2m quantifier hold for one related row

  - `test_quantifier_article` lists its `test_quantifier_link` rows through
    the o2m field `links`.
  - A Given creates its table's rows in one request; an empty cell is null.
  - A request authenticates as the admin. A response cell states the keys it
    checks; every key is a string the scenario chooses, all of one
    scenario's keys sharing a prefix of its own.

  Scenario: a _some with one condition keeps every parent a link matches
    Given the rows of test_quantifier_article:
      | id   |
      | qc-a |
      | qc-b |
      | qc-c |
    And their children in test_quantifier_link:
      | id    | article | name | status |
      | qc-a1 | qc-a    | a    | x      |
      | qc-b1 | qc-b    | a    | b      |
      | qc-c1 | qc-c    | y    | b      |
    When these requests get these responses:
      | request                              | response       |
      | method: GET                          | code: 200      |+
      | path: /items/test_quantifier_article | body:          |
      | query:                               |   data:        |
      |   fields: id                         |     - id: qc-a |
      |   sort: id                           |     - id: qc-b |
      |   filter[id][_starts_with]: qc-      |                |
      |   filter[links][_some][name][_eq]: a |                |

  Scenario: a _some with two conditions needs one link matching both
    Given the rows of test_quantifier_article:
      | id   |
      | qs-a |
      | qs-b |
    And their children in test_quantifier_link:
      | id    | article | name | status |
      | qs-a1 | qs-a    | a    | x      |
      | qs-a2 | qs-a    | y    | b      |
      | qs-b1 | qs-b    | a    | b      |
    When these requests get these responses:
      | request                                | response       |
      | method: GET                            | code: 200      |+
      | path: /items/test_quantifier_article   | body:          |
      | query:                                 |   data:        |
      |   fields: id                           |     - id: qs-b |
      |   sort: id                             |                |
      |   filter[id][_starts_with]: qs-        |                |
      |   filter[links][_some][name][_eq]: a   |                |
      |   filter[links][_some][status][_eq]: b |                |

  Scenario: a _some over an _and needs one link matching both
    Given the rows of test_quantifier_article:
      | id   |
      | qa-a |
      | qa-b |
    And their children in test_quantifier_link:
      | id    | article | name | status |
      | qa-a1 | qa-a    | a    | x      |
      | qa-a2 | qa-a    | y    | b      |
      | qa-b1 | qa-b    | a    | b      |
    When these requests get these responses:
      | request                                         | response       |
      | method: GET                                     | code: 200      |+
      | path: /items/test_quantifier_article            | body:          |
      | query:                                          |   data:        |
      |   fields: id                                    |     - id: qa-b |
      |   sort: id                                      |                |
      |   filter[id][_starts_with]: qa-                 |                |
      |   filter[links][_some][_and][0][name][_eq]: a   |                |
      |   filter[links][_some][_and][1][status][_eq]: b |                |

  Scenario: a _none with two conditions excludes only a link matching both
    Given the rows of test_quantifier_article:
      | id   |
      | qx-a |
      | qx-b |
      | qx-c |
    And their children in test_quantifier_link:
      | id    | article | name | status |
      | qx-a1 | qx-a    | a    | x      |
      | qx-b1 | qx-b    | a    | b      |
      | qx-c1 | qx-c    | a    | x      |
      | qx-c2 | qx-c    | y    | b      |
    When these requests get these responses:
      | request                                | response       |
      | method: GET                            | code: 200      |+
      | path: /items/test_quantifier_article   | body:          |
      | query:                                 |   data:        |
      |   fields: id                           |     - id: qx-a |
      |   sort: id                             |     - id: qx-c |
      |   filter[id][_starts_with]: qx-        |                |
      |   filter[links][_none][name][_eq]: a   |                |
      |   filter[links][_none][status][_eq]: b |                |

  Scenario: a _none over an _or excludes a link matching either
    Given the rows of test_quantifier_article:
      | id   |
      | qn-a |
      | qn-b |
      | qn-c |
    And their children in test_quantifier_link:
      | id    | article | name | status |
      | qn-a1 | qn-a    | a    | x      |
      | qn-b1 | qn-b    | c    | x      |
      | qn-c1 | qn-c    | b    | x      |
    When these requests get these responses:
      | request                                      | response       |
      | method: GET                                  | code: 200      |+
      | path: /items/test_quantifier_article         | body:          |
      | query:                                       |   data:        |
      |   fields: id                                 |     - id: qn-b |
      |   sort: id                                   |                |
      |   filter[id][_starts_with]: qn-              |                |
      |   filter[links][_none][_or][0][name][_eq]: a |                |
      |   filter[links][_none][_or][1][name][_eq]: b |                |
