Feature: A cached aggregate follows the rule that decides what it reads

  - `test_agg_cache_article` points at its `test_agg_cache_author` through the m2o field
    `author`, and lists its `test_agg_cache_link` rows through the o2m field `links`.
  - `groupBy` reads only the rows granting the group field, so the rule granting
    `salary` is not among the read's cases, yet it decides what `sum` returns.
  - A request authenticates as the admin, or with the token its `as` cell holds.
    `<run>` stands for a value unique to the scenario, and any other `<name>` for
    a uuid of its own. A response cell states the keys it checks.

  Scenario: a grouped sum follows its author
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_author       |           |
      | payload:                                 |           |
      |   - id: <run>-pub                        |           |
      |     status: live                         |           |
      |   - id: <run>-dft                        |           |
      |     status: draft                        |           |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_article      |           |
      | payload:                                 |           |
      |   - id: <run>-a                          |           |
      |     category: news                       |           |
      |     salary: 100                          |           |
      |     bonus: 1                             |           |
      |     author: <run>-pub                    |           |
      |   - id: <run>-b                          |           |
      |     category: news                       |           |
      |     salary: 900                          |           |
      |     bonus: 0                             |           |
      |     author: <run>-dft                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-0>                  |           |
      |   name: agg-cache-0-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - id                             |           |
      |         - author                         |           |
      |         - category                       |           |
      |       permissions: {}                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-1>                  |           |
      |   name: agg-cache-1-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - salary                         |           |
      |       permissions:                       |           |
      |         author:                          |           |
      |           status:                        |           |
      |             _eq: live                    |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: agg-cache-<run>@example.com     |           |
      |   token: <reader-token>                  |           |
      |   policies:                              |           |
      |     - policy: <reader-policy-0>          |           |
      |     - policy: <reader-policy-1>          |           |
    Then these requests get these responses:
      | request                                      | response               |
      | as: <reader-token>                           | code: 200              |+
      | method: GET                                  | headers:               |
      | path: /items/test_agg_cache_article          |   x-cache-status: MISS |
      | query:                                       | body:                  |
      |   aggregate[sum]: salary                     |   data:                |
      |   groupBy: category                          |     - category: news   |
      |   filter[id][_starts_with]: <run>-           |       sum:             |
      |                                              |         salary: "100"  |
      | as: <reader-token>                           | code: 200              |+
      | method: GET                                  | headers:               |
      | path: /items/test_agg_cache_article          |   x-cache-status: HIT  |
      | query:                                       | body:                  |
      |   aggregate[sum]: salary                     |   data:                |
      |   groupBy: category                          |     - category: news   |
      |   filter[id][_starts_with]: <run>-           |       sum:             |
      |                                              |         salary: "100"  |
      | method: PATCH                                | code: 200              |+
      | path: /items/test_agg_cache_author/<run>-pub |                        |
      | payload:                                     |                        |
      |   status: draft                              |                        |
      | as: <reader-token>                           | code: 200              |+
      | method: GET                                  | headers:               |
      | path: /items/test_agg_cache_article          |   x-cache-status: MISS |
      | query:                                       | body:                  |
      |   aggregate[sum]: salary                     |   data:                |
      |   groupBy: category                          |     - category: news   |
      |   filter[id][_starts_with]: <run>-           |       sum:             |
      |                                              |         salary: null   |

  Scenario: a grouped sum follows the m2o key its rule goes through
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_author       |           |
      | payload:                                 |           |
      |   - id: <run>-pub                        |           |
      |     status: live                         |           |
      |   - id: <run>-dft                        |           |
      |     status: draft                        |           |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_article      |           |
      | payload:                                 |           |
      |   - id: <run>-a                          |           |
      |     category: news                       |           |
      |     salary: 100                          |           |
      |     bonus: 1                             |           |
      |     author: <run>-pub                    |           |
      |   - id: <run>-b                          |           |
      |     category: news                       |           |
      |     salary: 900                          |           |
      |     bonus: 0                             |           |
      |     author: <run>-dft                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-0>                  |           |
      |   name: agg-cache-0-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - id                             |           |
      |         - author                         |           |
      |         - category                       |           |
      |       permissions: {}                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-1>                  |           |
      |   name: agg-cache-1-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - salary                         |           |
      |       permissions:                       |           |
      |         author:                          |           |
      |           status:                        |           |
      |             _eq: live                    |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: agg-cache-<run>@example.com     |           |
      |   token: <reader-token>                  |           |
      |   policies:                              |           |
      |     - policy: <reader-policy-0>          |           |
      |     - policy: <reader-policy-1>          |           |
    Then these requests get these responses:
      | request                                     | response               |
      | as: <reader-token>                          | code: 200              |+
      | method: GET                                 | headers:               |
      | path: /items/test_agg_cache_article         |   x-cache-status: MISS |
      | query:                                      | body:                  |
      |   aggregate[sum]: salary                    |   data:                |
      |   groupBy: category                         |     - category: news   |
      |   filter[id][_starts_with]: <run>-          |       sum:             |
      |                                             |         salary: "100"  |
      | as: <reader-token>                          | code: 200              |+
      | method: GET                                 | headers:               |
      | path: /items/test_agg_cache_article         |   x-cache-status: HIT  |
      | query:                                      | body:                  |
      |   aggregate[sum]: salary                    |   data:                |
      |   groupBy: category                         |     - category: news   |
      |   filter[id][_starts_with]: <run>-          |       sum:             |
      |                                             |         salary: "100"  |
      | method: PATCH                               | code: 200              |+
      | path: /items/test_agg_cache_article/<run>-a |                        |
      | payload:                                    |                        |
      |   author: <run>-dft                         |                        |
      | as: <reader-token>                          | code: 200              |+
      | method: GET                                 | headers:               |
      | path: /items/test_agg_cache_article         |   x-cache-status: MISS |
      | query:                                      | body:                  |
      |   aggregate[sum]: salary                    |   data:                |
      |   groupBy: category                         |     - category: news   |
      |   filter[id][_starts_with]: <run>-          |       sum:             |
      |                                             |         salary: null   |

  Scenario: a grouped sum follows a column of its own row that its rule reads
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_author       |           |
      | payload:                                 |           |
      |   - id: <run>-pub                        |           |
      |     status: live                         |           |
      |   - id: <run>-dft                        |           |
      |     status: draft                        |           |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_article      |           |
      | payload:                                 |           |
      |   - id: <run>-a                          |           |
      |     category: news                       |           |
      |     salary: 100                          |           |
      |     bonus: 1                             |           |
      |     author: <run>-pub                    |           |
      |   - id: <run>-b                          |           |
      |     category: news                       |           |
      |     salary: 900                          |           |
      |     bonus: 0                             |           |
      |     author: <run>-dft                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-0>                  |           |
      |   name: agg-cache-0-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - id                             |           |
      |         - author                         |           |
      |         - category                       |           |
      |       permissions: {}                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-1>                  |           |
      |   name: agg-cache-1-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - salary                         |           |
      |       permissions:                       |           |
      |         bonus:                           |           |
      |           _gt: 0                         |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: agg-cache-<run>@example.com     |           |
      |   token: <reader-token>                  |           |
      |   policies:                              |           |
      |     - policy: <reader-policy-0>          |           |
      |     - policy: <reader-policy-1>          |           |
    Then these requests get these responses:
      | request                                     | response               |
      | as: <reader-token>                          | code: 200              |+
      | method: GET                                 | headers:               |
      | path: /items/test_agg_cache_article         |   x-cache-status: MISS |
      | query:                                      | body:                  |
      |   aggregate[sum]: salary                    |   data:                |
      |   groupBy: category                         |     - category: news   |
      |   filter[id][_starts_with]: <run>-          |       sum:             |
      |                                             |         salary: "100"  |
      | as: <reader-token>                          | code: 200              |+
      | method: GET                                 | headers:               |
      | path: /items/test_agg_cache_article         |   x-cache-status: HIT  |
      | query:                                      | body:                  |
      |   aggregate[sum]: salary                    |   data:                |
      |   groupBy: category                         |     - category: news   |
      |   filter[id][_starts_with]: <run>-          |       sum:             |
      |                                             |         salary: "100"  |
      | method: PATCH                               | code: 200              |+
      | path: /items/test_agg_cache_article/<run>-a |                        |
      | payload:                                    |                        |
      |   bonus: 0                                  |                        |
      | as: <reader-token>                          | code: 200              |+
      | method: GET                                 | headers:               |
      | path: /items/test_agg_cache_article         |   x-cache-status: MISS |
      | query:                                      | body:                  |
      |   aggregate[sum]: salary                    |   data:                |
      |   groupBy: category                         |     - category: news   |
      |   filter[id][_starts_with]: <run>-          |       sum:             |
      |                                             |         salary: null   |

  Scenario: a grouped sum follows the o2m its rule goes through
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_article      |           |
      | payload:                                 |           |
      |   - id: <run>-a                          |           |
      |     category: news                       |           |
      |     salary: 100                          |           |
      |   - id: <run>-b                          |           |
      |     category: news                       |           |
      |     salary: 900                          |           |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_link         |           |
      | payload:                                 |           |
      |   - id: <run>-a1                         |           |
      |     article: <run>-a                     |           |
      |     name: pm                             |           |
      |   - id: <run>-b1                         |           |
      |     article: <run>-b                     |           |
      |     name: other                          |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-0>                  |           |
      |   name: agg-cache-0-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - id                             |           |
      |         - author                         |           |
      |         - category                       |           |
      |       permissions: {}                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-1>                  |           |
      |   name: agg-cache-1-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - salary                         |           |
      |       permissions:                       |           |
      |         links:                           |           |
      |           name:                          |           |
      |             _eq: pm                      |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: agg-cache-<run>@example.com     |           |
      |   token: <reader-token>                  |           |
      |   policies:                              |           |
      |     - policy: <reader-policy-0>          |           |
      |     - policy: <reader-policy-1>          |           |
    Then these requests get these responses:
      | request                                   | response               |
      | as: <reader-token>                        | code: 200              |+
      | method: GET                               | headers:               |
      | path: /items/test_agg_cache_article       |   x-cache-status: MISS |
      | query:                                    | body:                  |
      |   aggregate[sum]: salary                  |   data:                |
      |   groupBy: category                       |     - category: news   |
      |   filter[id][_starts_with]: <run>-        |       sum:             |
      |                                           |         salary: "100"  |
      | as: <reader-token>                        | code: 200              |+
      | method: GET                               | headers:               |
      | path: /items/test_agg_cache_article       |   x-cache-status: HIT  |
      | query:                                    | body:                  |
      |   aggregate[sum]: salary                  |   data:                |
      |   groupBy: category                       |     - category: news   |
      |   filter[id][_starts_with]: <run>-        |       sum:             |
      |                                           |         salary: "100"  |
      | method: PATCH                             | code: 200              |+
      | path: /items/test_agg_cache_link/<run>-a1 |                        |
      | payload:                                  |                        |
      |   name: other                             |                        |
      | as: <reader-token>                        | code: 200              |+
      | method: GET                               | headers:               |
      | path: /items/test_agg_cache_article       |   x-cache-status: MISS |
      | query:                                    | body:                  |
      |   aggregate[sum]: salary                  |   data:                |
      |   groupBy: category                       |     - category: news   |
      |   filter[id][_starts_with]: <run>-        |       sum:             |
      |                                           |         salary: null   |

  Scenario: a nested grouped sum follows the column its rule reads on the children
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_article      |           |
      | payload:                                 |           |
      |   - id: <run>-a                          |           |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_link         |           |
      | payload:                                 |           |
      |   - id: <run>-a1                         |           |
      |     article: <run>-a                     |           |
      |     name: pm                             |           |
      |     weight: 5                            |           |
      |   - id: <run>-a2                         |           |
      |     article: <run>-a                     |           |
      |     name: other                          |           |
      |     weight: 900                          |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-0>                  |           |
      |   name: agg-cache-0-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - id                             |           |
      |         - links                          |           |
      |       permissions: {}                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-1>                  |           |
      |   name: agg-cache-1-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_link    |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - id                             |           |
      |         - article                        |           |
      |         - name                           |           |
      |       permissions: {}                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-2>                  |           |
      |   name: agg-cache-2-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_link    |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - weight                         |           |
      |       permissions:                       |           |
      |         name:                            |           |
      |           _eq: pm                        |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: agg-cache-<run>@example.com     |           |
      |   token: <reader-token>                  |           |
      |   policies:                              |           |
      |     - policy: <reader-policy-0>          |           |
      |     - policy: <reader-policy-1>          |           |
      |     - policy: <reader-policy-2>          |           |
    Then these requests get these responses:
      | request                                   | response                   |
      | as: <reader-token>                        | code: 200                  |+
      | method: GET                               | headers:                   |
      | path: /items/test_agg_cache_article       |   x-cache-status: MISS     |
      | query:                                    | body:                      |
      |   fields: id,links.article                |   data:                    |
      |   filter[id][_eq]: <run>-a                |     - id: <run>-a          |
      |   deep[links][_groupBy]: article          |       links:               |
      |   deep[links][_aggregate][sum]: weight    |         - article: <run>-a |
      |   deep[links][_sort]: article             |           sum:             |
      |                                           |             weight: "5"    |
      | as: <reader-token>                        | code: 200                  |+
      | method: GET                               | headers:                   |
      | path: /items/test_agg_cache_article       |   x-cache-status: HIT      |
      | query:                                    | body:                      |
      |   fields: id,links.article                |   data:                    |
      |   filter[id][_eq]: <run>-a                |     - id: <run>-a          |
      |   deep[links][_groupBy]: article          |       links:               |
      |   deep[links][_aggregate][sum]: weight    |         - article: <run>-a |
      |   deep[links][_sort]: article             |           sum:             |
      |                                           |             weight: "5"    |
      | method: PATCH                             | code: 200                  |+
      | path: /items/test_agg_cache_link/<run>-a1 |                            |
      | payload:                                  |                            |
      |   name: other                             |                            |
      | as: <reader-token>                        | code: 200                  |+
      | method: GET                               | headers:                   |
      | path: /items/test_agg_cache_article       |   x-cache-status: MISS     |
      | query:                                    | body:                      |
      |   fields: id,links.article                |   data:                    |
      |   filter[id][_eq]: <run>-a                |     - id: <run>-a          |
      |   deep[links][_groupBy]: article          |       links:               |
      |   deep[links][_aggregate][sum]: weight    |         - article: <run>-a |
      |   deep[links][_sort]: article             |           sum:             |
      |                                           |             weight: null   |

  Scenario: an ungrouped sum follows its author too, its cases holding the rule
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_author       |           |
      | payload:                                 |           |
      |   - id: <run>-pub                        |           |
      |     status: live                         |           |
      |   - id: <run>-dft                        |           |
      |     status: draft                        |           |
      | method: POST                             | code: 200 |+
      | path: /items/test_agg_cache_article      |           |
      | payload:                                 |           |
      |   - id: <run>-a                          |           |
      |     category: news                       |           |
      |     salary: 100                          |           |
      |     bonus: 1                             |           |
      |     author: <run>-pub                    |           |
      |   - id: <run>-b                          |           |
      |     category: news                       |           |
      |     salary: 900                          |           |
      |     bonus: 0                             |           |
      |     author: <run>-dft                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-0>                  |           |
      |   name: agg-cache-0-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - id                             |           |
      |         - author                         |           |
      |       permissions: {}                    |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy-1>                  |           |
      |   name: agg-cache-1-<run>                |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_agg_cache_article |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - salary                         |           |
      |       permissions:                       |           |
      |         author:                          |           |
      |           status:                        |           |
      |             _eq: live                    |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: agg-cache-<run>@example.com     |           |
      |   token: <reader-token>                  |           |
      |   policies:                              |           |
      |     - policy: <reader-policy-0>          |           |
      |     - policy: <reader-policy-1>          |           |
    Then these requests get these responses:
      | request                                      | response               |
      | as: <reader-token>                           | code: 200              |+
      | method: GET                                  | headers:               |
      | path: /items/test_agg_cache_article          |   x-cache-status: MISS |
      | query:                                       | body:                  |
      |   aggregate[sum]: salary                     |   data:                |
      |   filter[id][_starts_with]: <run>-           |     - sum:             |
      |                                              |         salary: "100"  |
      | as: <reader-token>                           | code: 200              |+
      | method: GET                                  | headers:               |
      | path: /items/test_agg_cache_article          |   x-cache-status: HIT  |
      | query:                                       | body:                  |
      |   aggregate[sum]: salary                     |   data:                |
      |   filter[id][_starts_with]: <run>-           |     - sum:             |
      |                                              |         salary: "100"  |
      | method: PATCH                                | code: 200              |+
      | path: /items/test_agg_cache_author/<run>-pub |                        |
      | payload:                                     |                        |
      |   status: draft                              |                        |
      | as: <reader-token>                           | code: 200              |+
      | method: GET                                  | headers:               |
      | path: /items/test_agg_cache_article          |   x-cache-status: MISS |
      | query:                                       | body:                  |
      |   aggregate[sum]: salary                     |   data:                |
      |   filter[id][_starts_with]: <run>-           |     - sum:             |
      |                                              |         salary: null   |
