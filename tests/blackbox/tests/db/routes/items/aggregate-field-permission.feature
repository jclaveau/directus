Feature: An aggregate reads a field only on the rows granting it

  - `test_agg_field_article` points at its `test_agg_field_author`
    through the m2o field `author`, and lists its `test_agg_field_link` rows
    through the o2m field `links`.
  - A row a reader may read but whose `salary` is hidden still counts in
    `aggregate[count]: '*'`, and adds nothing to an aggregate of `salary`.
  - An aggregate grouped by `category` reads only the rows granting `category`,
    since a permission granting no requested field is ignored.
  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a sum on a field granted through a relation skips the rows hiding it
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | salary |
      | <run>-a | <run>-pub | 100    |
      | <run>-n | <run>-pub |        |
      | <run>-b | <run>-dft | 900    |
      | <run>-c | <run>-dft | 500    |
    And a user whose token is <reader-token> may read:
      | collection             | fields    | permissions                     |
      | test_agg_field_article | id,author | {}                              |
      | test_agg_field_article | salary    | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - id: <run>-a     |
      |   fields: id,salary                 |       salary: 100     |
      |   filter[id][_starts_with]: <run>-  |     - id: <run>-b     |
      |   sort: id                          |       salary: null    |
      |                                     |     - id: <run>-c     |
      |                                     |       salary: null    |
      |                                     |     - id: <run>-n     |
      |                                     |       salary: null    |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - count: "4"      |
      |   aggregate[sum]: salary            |       sum:            |
      |   aggregate[count]: '*'             |         salary: "100" |
      |   filter[id][_starts_with]: <run>-  |                       |

  Scenario: every aggregate of a field granted through a relation skips the rows hiding it
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | salary |
      | <run>-a | <run>-pub | 100    |
      | <run>-d | <run>-pub | 100    |
      | <run>-e | <run>-pub | 400    |
      | <run>-n | <run>-pub |        |
      | <run>-b | <run>-dft | 50     |
      | <run>-c | <run>-dft | 900    |
    And a user whose token is <reader-token> may read:
      | collection             | fields    | permissions                     |
      | test_agg_field_article | id,author | {}                              |
      | test_agg_field_article | salary    | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response                               |
      | as: <reader-token>                  | code: 200                              |+
      | method: GET                         | body:                                  |
      | path: /items/test_agg_field_article |   data:                                |
      | query:                              |     - count:                           |
      |   aggregate[count]: salary          |         salary: "3"                    |
      |   aggregate[countDistinct]: salary  |       countDistinct:                   |
      |   aggregate[sumDistinct]: salary    |         salary: "2"                    |
      |   aggregate[avg]: salary            |       sumDistinct:                     |
      |   aggregate[avgDistinct]: salary    |         salary: "500"                  |
      |   aggregate[min]: salary            |       avg:                             |
      |   aggregate[max]: salary            |         salary: "200.0000000000000000" |
      |   filter[id][_starts_with]: <run>-  |       avgDistinct:                     |
      |                                     |         salary: "250.0000000000000000" |
      |                                     |       min:                             |
      |                                     |         salary: 100                    |
      |                                     |       max:                             |
      |                                     |         salary: 400                    |

  Scenario: an aggregate filtered on a row hiding the field returns null
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | salary |
      | <run>-b | <run>-dft | 900    |
    And a user whose token is <reader-token> may read:
      | collection             | fields    | permissions                     |
      | test_agg_field_article | id,author | {}                              |
      | test_agg_field_article | salary    | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response             |
      | as: <reader-token>                  | code: 200            |+
      | method: GET                         | body:                |
      | path: /items/test_agg_field_article |   data:              |
      | query:                              |     - max:           |
      |   aggregate[max]: salary            |         salary: null |
      |   filter[id][_eq]: <run>-b          |                      |

  Scenario: an aggregate reads every row for the admin and a reader granted it on all
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | salary |
      | <run>-a | <run>-pub | 100    |
      | <run>-b | <run>-dft | 900    |
    And a user whose token is <reader-token> may read:
      | collection             | fields    | permissions |
      | test_agg_field_article | id,salary | {}          |
    Then these requests get these responses:
      | request                             | response               |
      | method: GET                         | code: 200              |+
      | path: /items/test_agg_field_article | body:                  |
      | query:                              |   data:                |
      |   aggregate[sum]: salary            |     - sum:             |
      |   filter[id][_starts_with]: <run>-  |         salary: "1000" |
      | as: <reader-token>                  | code: 200              |+
      | method: GET                         | body:                  |
      | path: /items/test_agg_field_article |   data:                |
      | query:                              |     - sum:             |
      |   aggregate[sum]: salary            |         salary: "1000" |
      |   filter[id][_starts_with]: <run>-  |                        |

  Scenario: an aggregate under one rule on every field reads the rows of that rule
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | salary |
      | <run>-a | <run>-pub | 100    |
      | <run>-b | <run>-dft | 900    |
    And a user whose token is <reader-token> may read:
      | collection             | fields | permissions                     |
      | test_agg_field_article | '*'    | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - count: "1"      |
      |   aggregate[sum]: salary            |       sum:            |
      |   aggregate[count]: '*'             |         salary: "100" |
      |   filter[id][_starts_with]: <run>-  |                       |

  Scenario: an aggregate on a field two rules grant reads the rows of either rule
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | category | author    | salary |
      | <run>-a | sport    | <run>-pub | 100    |
      | <run>-b | news     | <run>-dft | 200    |
      | <run>-c | sport    | <run>-dft | 900    |
      | <run>-e | news     | <run>-pub | 400    |
    And a user whose token is <reader-token> may read:
      | collection             | fields             | permissions                     |
      | test_agg_field_article | id,author,category | {}                              |
      | test_agg_field_article | salary             | {author: {status: {_eq: live}}} |
      | test_agg_field_article | salary             | {category: {_eq: news}}         |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - sum:            |
      |   aggregate[sum]: salary            |         salary: "700" |
      |   filter[id][_starts_with]: <run>-  |                       |

  Scenario: a grouped aggregate skips the rows hiding the field in each group
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | category | author    | salary |
      | <run>-a | news     | <run>-pub | 100    |
      | <run>-b | news     | <run>-dft | 900    |
      | <run>-c | sport    | <run>-dft | 500    |
    And a user whose token is <reader-token> may read:
      | collection             | fields             | permissions                     |
      | test_agg_field_article | id,author,category | {}                              |
      | test_agg_field_article | salary             | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - category: news  |
      |   aggregate[sum]: salary            |       sum:            |
      |   groupBy: category                 |         salary: "100" |
      |   filter[id][_starts_with]: <run>-  |     - category: sport |
      |   sort: sum.salary                  |       sum:            |
      |                                     |         salary: null  |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - category: news  |
      |   aggregate[sum]: salary            |       sum:            |
      |   groupBy: category                 |         salary: "100" |
      |   filter[id][_starts_with]: <run>-  |     - category: sport |
      |   sort: category                    |       sum:            |
      |                                     |         salary: null  |

  Scenario: a grouped aggregate reads its field by that field's rule, not the group's
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | category | author    | salary |
      | <run>-a | news     | <run>-pub | 100    |
      | <run>-b | news     | <run>-dft | 900    |
      | <run>-c | sport    | <run>-pub | 500    |
    And a user whose token is <reader-token> may read:
      | collection             | fields    | permissions                     |
      | test_agg_field_article | id,author | {}                              |
      | test_agg_field_article | category  | {category: {_eq: news}}         |
      | test_agg_field_article | salary    | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - category: news  |
      |   aggregate[sum]: salary            |       sum:            |
      |   groupBy: category                 |         salary: "100" |
      |   filter[id][_starts_with]: <run>-  |                       |

  Scenario: an aggregate on a field granted through an o2m reads a parent once
    Given the rows of test_agg_field_article:
      | id      | salary |
      | <run>-a | 100    |
      | <run>-b | 900    |
    And their children in test_agg_field_link:
      | id       | article | name  |
      | <run>-a1 | <run>-a | pm    |
      | <run>-a2 | <run>-a | pm    |
      | <run>-b1 | <run>-b | other |
    And a user whose token is <reader-token> may read:
      | collection             | fields   | permissions                |
      | test_agg_field_article | id,links | {}                         |
      | test_agg_field_article | salary   | {links: {name: {_eq: pm}}} |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - count:          |
      |   aggregate[sum]: salary            |         salary: "1"   |
      |   aggregate[count]: salary          |       sum:            |
      |   filter[id][_starts_with]: <run>-  |         salary: "100" |

  Scenario: an aggregate filtered through an o2m still skips the rows hiding the field
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | salary |
      | <run>-a | <run>-pub | 100    |
      | <run>-b | <run>-dft | 900    |
      | <run>-c | <run>-pub | 500    |
    And their grandchildren in test_agg_field_link:
      | id       | article | name  |
      | <run>-a1 | <run>-a | pm    |
      | <run>-a2 | <run>-a | pm    |
      | <run>-b1 | <run>-b | pm    |
      | <run>-c1 | <run>-c | other |
    And a user whose token is <reader-token> may read:
      | collection             | fields          | permissions                     |
      | test_agg_field_article | id,author,links | {}                              |
      | test_agg_field_article | salary          | {author: {status: {_eq: live}}} |
      | test_agg_field_link    | name            | {}                              |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - count: "2"      |
      |   aggregate[sum]: salary            |       sum:            |
      |   aggregate[count]: '*'             |         salary: "100" |
      |   filter[id][_starts_with]: <run>-  |                       |
      |   filter[links][name][_eq]: pm      |                       |

  Scenario: an aggregate filtered through an m2o still skips the rows hiding the field
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | salary |
      | <run>-a | <run>-pub | 100    |
      | <run>-b | <run>-dft | 900    |
      | <run>-c | <run>-dft | 500    |
    And a user whose token is <reader-token> may read:
      | collection             | fields    | permissions                     |
      | test_agg_field_article | id,author | {}                              |
      | test_agg_field_article | salary    | {author: {status: {_eq: live}}} |
      | test_agg_field_author  | status    | {}                              |
    Then these requests get these responses:
      | request                                   | response              |
      | as: <reader-token>                        | code: 200             |+
      | method: GET                               | body:                 |
      | path: /items/test_agg_field_article       |   data:               |
      | query:                                    |     - count: "3"      |
      |   aggregate[sum]: salary                  |       sum:            |
      |   aggregate[count]: '*'                   |         salary: "100" |
      |   filter[id][_starts_with]: <run>-        |                       |
      |   filter[author][status][_in]: live,draft |                       |
      | as: <reader-token>                        | code: 200             |+
      | method: GET                               | body:                 |
      | path: /items/test_agg_field_article       |   data:               |
      | query:                                    |     - count: "2"      |
      |   aggregate[sum]: salary                  |       sum:            |
      |   aggregate[count]: '*'                   |         salary: null  |
      |   filter[id][_starts_with]: <run>-        |                       |
      |   filter[author][status][_eq]: draft      |                       |

  Scenario: two aggregated fields each read through their own rule
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | category | author    | salary | bonus |
      | <run>-a | news     | <run>-pub | 100    | 7     |
      | <run>-b | sport    | <run>-pub | 200    | 900   |
      | <run>-c | news     | <run>-dft | 900    | 30    |
    And a user whose token is <reader-token> may read:
      | collection             | fields             | permissions                     |
      | test_agg_field_article | id,author,category | {}                              |
      | test_agg_field_article | salary             | {author: {status: {_eq: live}}} |
      | test_agg_field_article | bonus              | {category: {_eq: news}}         |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - sum:            |
      |   aggregate[sum]: salary,bonus      |         salary: "300" |
      |   filter[id][_starts_with]: <run>-  |         bonus: "37"   |

  Scenario: an aggregate reads a field through a rule on it and a rule on every field
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | category | author    | salary |
      | <run>-a | sport    | <run>-pub | 100    |
      | <run>-b | news     | <run>-dft | 200    |
      | <run>-c | sport    | <run>-dft | 900    |
    And a user whose token is <reader-token> may read:
      | collection             | fields | permissions                     |
      | test_agg_field_article | id     | {}                              |
      | test_agg_field_article | salary | {author: {status: {_eq: live}}} |
      | test_agg_field_article | '*'    | {category: {_eq: news}}         |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - sum:            |
      |   aggregate[sum]: salary            |         salary: "300" |
      |   filter[id][_starts_with]: <run>-  |                       |

  Scenario: a grouped aggregate filtered through an o2m skips the rows hiding the field
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | category | author    | salary |
      | <run>-a | news     | <run>-pub | 100    |
      | <run>-b | news     | <run>-dft | 900    |
      | <run>-c | sport    | <run>-dft | 500    |
      | <run>-d | news     | <run>-pub | 300    |
    And their grandchildren in test_agg_field_link:
      | id       | article | name  |
      | <run>-a1 | <run>-a | pm    |
      | <run>-a2 | <run>-a | pm    |
      | <run>-b1 | <run>-b | pm    |
      | <run>-c1 | <run>-c | pm    |
      | <run>-d1 | <run>-d | other |
    And a user whose token is <reader-token> may read:
      | collection             | fields            | permissions                     |
      | test_agg_field_article | id,category,links | {}                              |
      | test_agg_field_article | salary            | {author: {status: {_eq: live}}} |
      | test_agg_field_link    | name              | {}                              |
    Then these requests get these responses:
      | request                             | response              |
      | as: <reader-token>                  | code: 200             |+
      | method: GET                         | body:                 |
      | path: /items/test_agg_field_article |   data:               |
      | query:                              |     - category: news  |
      |   aggregate[sum]: salary            |       sum:            |
      |   groupBy: category                 |         salary: "100" |
      |   filter[id][_starts_with]: <run>-  |     - category: sport |
      |   filter[links][name][_eq]: pm      |       sum:            |
      |   sort: category                    |         salary: null  |

  Scenario: a nested aggregate reads a field only on the children granting it
    Given the rows of test_agg_field_article:
      | id      |
      | <run>-a |
    And their children in test_agg_field_link:
      | id       | article | name  | weight |
      | <run>-a1 | <run>-a | pm    | 5      |
      | <run>-a2 | <run>-a | other | 900    |
    And a user whose token is <reader-token> may read:
      | collection             | fields          | permissions       |
      | test_agg_field_article | id,links        | {}                |
      | test_agg_field_link    | id,article,name | {}                |
      | test_agg_field_link    | weight          | {name: {_eq: pm}} |
    Then these requests get these responses:
      | request                                | response                   |
      | as: <reader-token>                     | code: 200                  |+
      | method: GET                            | body:                      |
      | path: /items/test_agg_field_article    |   data:                    |
      | query:                                 |     - id: <run>-a          |
      |   fields: id,links.article             |       links:               |
      |   filter[id][_eq]: <run>-a             |         - article: <run>-a |
      |   deep[links][_groupBy]: article       |           sum:             |
      |   deep[links][_aggregate][sum]: weight |             weight: "5"    |
      |   deep[links][_sort]: article          |                            |

  Scenario: a count of the primary key counts every row read, a min keeps its rule
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | category |
      | <run>-a | <run>-dft | news     |
      | <run>-b | <run>-dft | news     |
      | <run>-c | <run>-pub | sport    |
    And a user whose token is <reader-token> may read:
      | collection             | fields      | permissions                     |
      | test_agg_field_article | category    | {category: {_eq: news}}         |
      | test_agg_field_article | id,category | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response             |
      | as: <reader-token>                  | code: 200            |+
      | method: GET                         | body:                |
      | path: /items/test_agg_field_article |   meta:              |
      | query:                              |     filter_count: 3  |
      |   fields: category                  |                      |
      |   meta: filter_count                |                      |
      |   filter[id][_starts_with]: <run>-  |                      |
      | as: <reader-token>                  | code: 200            |+
      | method: GET                         | body:                |
      | path: /items/test_agg_field_article |   data:              |
      | query:                              |     - count:         |
      |   aggregate[count]: id              |         id: "3"      |
      |   filter[id][_starts_with]: <run>-  |                      |
      | as: <reader-token>                  | code: 200            |+
      | method: GET                         | body:                |
      | path: /items/test_agg_field_article |   data:              |
      | query:                              |     - countDistinct: |
      |   aggregate[countDistinct]: id      |         id: "3"      |
      |   filter[id][_starts_with]: <run>-  |                      |
      | as: <reader-token>                  | code: 200            |+
      | method: GET                         | body:                |
      | path: /items/test_agg_field_article |   data:              |
      | query:                              |     - min:           |
      |   aggregate[min]: id                |         id: <run>-c  |
      |   filter[id][_starts_with]: <run>-  |                      |

  Scenario: a distinct count of every field counts every row read
    Given the rows of test_agg_field_author:
      | id        | status |
      | <run>-pub | live   |
      | <run>-dft | draft  |
    And their children in test_agg_field_article:
      | id      | author    | category |
      | <run>-a | <run>-dft | news     |
      | <run>-b | <run>-dft | news     |
      | <run>-c | <run>-pub | sport    |
    And a user whose token is <reader-token> may read:
      | collection             | fields | permissions                     |
      | test_agg_field_article | *      | {category: {_eq: news}}         |
      | test_agg_field_article | id     | {author: {status: {_eq: live}}} |
    Then these requests get these responses:
      | request                             | response             |
      | as: <reader-token>                  | code: 200            |+
      | method: GET                         | body:                |
      | path: /items/test_agg_field_article |   data:              |
      | query:                              |     - countDistinct: |
      |   aggregate[countDistinct]: '*'     |         '*': "3"     |
      |   filter[id][_starts_with]: <run>-  |                      |
