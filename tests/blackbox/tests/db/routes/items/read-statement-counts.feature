Feature: A read runs the statements its query needs, and no more

  - A request cell is YAML: `method`, `path`, `query`, `token`. A list under
    `query` is sent joined by commas. A request authenticates as the admin,
    unless its `token` names another user.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_read_counts_article` rows `first` and `second` are published,
    `third` is a draft. Each has an `author` reaching
    `test_read_counts_author` (`ada`, `bob`). `first` lists the comments `c1`
    and `c2` through their `article`, the tags `perf` and `sql` through the
    junction `test_read_counts_article_tag`, and the quote `q1` through its
    many-to-any `blocks`. `second` holds the tag `perf`.
  - `ReadStatementCountsToken` is a user whose policy reads only the published
    articles, and every row they reach.
  - The step counting the statements names each request by its row in the
    request table; it holds on postgres only.

  Scenario: an admin lists the published articles with their author
    When these requests get these responses:
      | request                               | response            |
      | method: GET                           | code: 200           |+
      | path: /items/test_read_counts_article | body:               |
      | query:                                |   data:             |
      |   filter[status][_eq]: published      |     - title: First  |
      |   fields: [title, author.name]        |       author:       |
      |   sort: title                         |         name: Ada   |
      |                                       |     - title: Second |
      |                                       |       author:       |
      |                                       |         name: Bob   |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |

  Scenario: an admin reads one article through every kind of relation
    When these requests get these responses:
      | request                                       | response                         |
      | method: GET                                   | code: 200                        |+
      | path: /items/test_read_counts_article/first   | body:                            |
      | query:                                        |   data:                          |
      |   fields:                                     |     title: First                 |
      |     - title                                   |     author:                      |
      |     - author.name                             |       name: Ada                  |
      |     - comments.body                           |     comments:                    |
      |     - tags.test_read_counts_tag_id.name       |       - body: More               |
      |     - blocks.item:test_read_counts_quote.text |       - body: Nice               |
      |   deep[comments][_sort]: body                 |     tags:                        |
      |                                               |       - test_read_counts_tag_id: |
      |                                               |           name: Perf             |
      |                                               |       - test_read_counts_tag_id: |
      |                                               |           name: SQL              |
      |                                               |     blocks:                      |
      |                                               |       - item:                    |
      |                                               |           text: Measure first    |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |

  Scenario: an admin filters the articles on their author's name
    When these requests get these responses:
      | request                               | response        |
      | method: GET                           | code: 200       |+
      | path: /items/test_read_counts_article | body:           |
      | query:                                |   data:         |
      |   filter[author][name][_eq]: Ada      |     - id: first |
      |   fields: id                          |     - id: third |
      |   sort: id                            |                 |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |

  Scenario: an admin counts the articles of each status
    When these requests get these responses:
      | request                               | response                |
      | method: GET                           | code: 200               |+
      | path: /items/test_read_counts_article | body:                   |
      | query:                                |   data:                 |
      |   aggregate[count]: '*'               |     - status: draft     |
      |   groupBy: status                     |     - status: published |
      |   sort: status                        |                         |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |

  Scenario: a user whose policy filters the articles lists the ones it allows, twice
    When these requests get these responses:
      | request                               | response            |
      | method: GET                           | code: 200           |+
      | path: /items/test_read_counts_article | body:               |
      | query:                                |   data:             |
      |   fields: [title, author.name]        |     - title: First  |
      |   sort: title                         |       author:       |
      | token: ReadStatementCountsToken       |         name: Ada   |
      |                                       |     - title: Second |
      |                                       |       author:       |
      |                                       |         name: Bob   |
      | method: GET                           | code: 200           |+
      | path: /items/test_read_counts_article | body:               |
      | query:                                |   data:             |
      |   fields: [title, author.name]        |     - title: First  |
      |   sort: title                         |       author:       |
      | token: ReadStatementCountsToken       |         name: Ada   |
      |                                       |     - title: Second |
      |                                       |       author:       |
      |                                       |         name: Bob   |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |
      | 2       | -     | 0      | 0      | 0      | 0      |

  Scenario: a user whose policy filters the articles reads one through every relation
    When these requests get these responses:
      | request                                       | response                         |
      | method: GET                                   | code: 200                        |+
      | path: /items/test_read_counts_article/first   | body:                            |
      | query:                                        |   data:                          |
      |   fields:                                     |     title: First                 |
      |     - title                                   |     author:                      |
      |     - author.name                             |       name: Ada                  |
      |     - comments.body                           |     comments:                    |
      |     - tags.test_read_counts_tag_id.name       |       - body: More               |
      |     - blocks.item:test_read_counts_quote.text |       - body: Nice               |
      |   deep[comments][_sort]: body                 |     tags:                        |
      | token: ReadStatementCountsToken               |       - test_read_counts_tag_id: |
      |                                               |           name: Perf             |
      |                                               |       - test_read_counts_tag_id: |
      |                                               |           name: SQL              |
      |                                               |     blocks:                      |
      |                                               |       - item:                    |
      |                                               |           text: Measure first    |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |

  Scenario: a user whose policy filters the articles is refused a draft
    When these requests get these responses:
      | request                                     | response  |
      | method: GET                                 | code: 403 |+
      | path: /items/test_read_counts_article/third |           |
      | token: ReadStatementCountsToken             |           |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |
