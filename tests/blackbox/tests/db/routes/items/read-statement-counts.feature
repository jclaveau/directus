Feature: A read runs the statements its query needs, and no more

  - A request cell is YAML: `method`, `path`, `query`, `payload`, `token`.
    A list under `query` is sent joined by commas. A request authenticates as
    the admin, unless its `token` names another user. A GraphQL read is a
    `POST /graphql` whose `payload` holds the `query`.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_read_counts_article` rows `first` and `second` are published,
    `third` is a draft. Each has an `author` reaching
    `test_read_counts_author` (`ada`, `bob`). `first` lists the comments `c1`
    and `c2` through their `article`, the tags `perf` and `sql` through the
    junction `test_read_counts_article_tag`, and the quote `q1` through its
    many-to-any `blocks`. `second` holds the tag `perf`.
  - `ReadStatementCountsToken` is a user whose policy reads only the published
    articles, every row they reach, and the files; it has app access. They
    sign in as `read-statement-counts@default.com`, password
    `read-statement-counts-password`.
  - A login row's `remember` keeps what it answered under a name: the access
    token of a `json` login, the cookie of a `session` one. A row sends them
    with `as: <name>`, or no credentials at all with `as: public`.
  - The file `4f6c2a9e-1b3d-4c8e-9a7f-2d5e8b1c0a63` holds "Measure first".
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
      | request | table                    | select | insert | update | delete |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_author  | 1      | 0      | 0      | 0      |

  Scenario: an admin reads one article through every kind of relation
    When these requests get these responses:
      | request                                     | response                         |
      | method: GET                                 | code: 200                        |+
      | path: /items/test_read_counts_article/first | body:                            |
      | query:                                      |   data:                          |
      |   fields:                                   |     title: First                 |
      |   - title                                   |     author:                      |
      |   - author.name                             |       name: Ada                  |
      |   - comments.body                           |     comments:                    |
      |   - tags.test_read_counts_tag_id.name       |       - body: More               |
      |   - blocks.item:test_read_counts_quote.text |       - body: Nice               |
      |   deep[comments][_sort]: body               |     tags:                        |
      |   deep[tags][_sort]: id                     |       - test_read_counts_tag_id: |
      |                                             |           name: Perf             |
      |                                             |       - test_read_counts_tag_id: |
      |                                             |           name: SQL              |
      |                                             |     blocks:                      |
      |                                             |       - item:                    |
      |                                             |           text: Measure first    |
    And on postgres the requests ran these statements:
      | request | table                          | select | insert | update | delete |
      | 1       | directus_users                 | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article       | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article_block | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article_tag   | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_author        | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_comment       | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_quote         | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_tag           | 1      | 0      | 0      | 0      |

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
      | request | table                    | select | insert | update | delete |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |

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
      | request | table                    | select | insert | update | delete |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |

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
      | request | table                    | select | insert | update | delete |
      | 1       | directus_access          | 3      | 0      | 0      | 0      |
      | 1       | directus_permissions     | 4      | 0      | 0      | 0      |
      | 1       | directus_policies        | 1      | 0      | 0      | 0      |
      | 1       | directus_roles           | 1      | 0      | 0      | 0      |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_author  | 1      | 0      | 0      | 0      |
      | 2       | directus_users           | 1      | 0      | 0      | 0      |
      | 2       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 2       | test_read_counts_author  | 1      | 0      | 0      | 0      |

  Scenario: a user whose policy filters the articles reads one through every relation
    When these requests get these responses:
      | request                                     | response                         |
      | method: GET                                 | code: 200                        |+
      | path: /items/test_read_counts_article/first | body:                            |
      | query:                                      |   data:                          |
      |   fields:                                   |     title: First                 |
      |   - title                                   |     author:                      |
      |   - author.name                             |       name: Ada                  |
      |   - comments.body                           |     comments:                    |
      |   - tags.test_read_counts_tag_id.name       |       - body: More               |
      |   - blocks.item:test_read_counts_quote.text |       - body: Nice               |
      |   deep[comments][_sort]: body               |     tags:                        |
      |   deep[tags][_sort]: id                     |       - test_read_counts_tag_id: |
      | token: ReadStatementCountsToken             |           name: Perf             |
      |                                             |       - test_read_counts_tag_id: |
      |                                             |           name: SQL              |
      |                                             |     blocks:                      |
      |                                             |       - item:                    |
      |                                             |           text: Measure first    |
    And on postgres the requests ran these statements:
      | request | table                          | select | insert | update | delete |
      | 1       | directus_permissions           | 6      | 0      | 0      | 0      |
      | 1       | directus_users                 | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article       | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article_block | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article_tag   | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_author        | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_comment       | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_quote         | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_tag           | 1      | 0      | 0      | 0      |

  Scenario: a user whose policy filters the articles is refused a draft
    When these requests get these responses:
      | request                                     | response  |
      | method: GET                                 | code: 403 |+
      | path: /items/test_read_counts_article/third |           |
      | token: ReadStatementCountsToken             |           |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_permissions     | 1      | 0      | 0      | 0      |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |



  Scenario: a user signs in for a token and reads with it
    When these requests get these responses:
      | request                                    | response         |
      | method: POST                               | code: 200        |+
      | path: /auth/login                          |                  |
      | payload:                                   |                  |
      |   email: read-statement-counts@default.com |                  |
      |   password: read-statement-counts-password |                  |
      |   mode: json                               |                  |
      | as: public                                 |                  |
      | remember: reader-token                     |                  |
      | method: GET                                | code: 200        |+
      | path: /items/test_read_counts_article      | body:            |
      | query:                                     |   data:          |
      |   filter[status][_eq]: published           |     - id: first  |
      |   fields: id                               |     - id: second |
      |   sort: id                                 |                  |
      | as: reader-token                           |                  |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_activity        | 0      | 1      | 0      | 0      |
      | 1       | directus_sessions        | 0      | 1      | 0      | 1      |
      | 1       | directus_settings        | 1      | 0      | 0      | 0      |
      | 1       | directus_users           | 2      | 0      | 1      | 0      |
      | 2       | test_read_counts_article | 1      | 0      | 0      | 0      |

  Scenario: a user signs in for a session, reads with it twice and refreshes it
    When these requests get these responses:
      | request                                    | response         |
      | method: POST                               | code: 200        |+
      | path: /auth/login                          |                  |
      | payload:                                   |                  |
      |   email: read-statement-counts@default.com |                  |
      |   password: read-statement-counts-password |                  |
      |   mode: session                            |                  |
      | as: public                                 |                  |
      | remember: reader-session                   |                  |
      | method: GET                                | code: 200        |+
      | path: /items/test_read_counts_article      | body:            |
      | query:                                     |   data:          |
      |   filter[status][_eq]: published           |     - id: first  |
      |   fields: id                               |     - id: second |
      |   sort: id                                 |                  |
      | as: reader-session                         |                  |
      | method: GET                                | code: 200        |+
      | path: /items/test_read_counts_article      | body:            |
      | query:                                     |   data:          |
      |   filter[status][_eq]: published           |     - id: first  |
      |   fields: id                               |     - id: second |
      |   sort: id                                 |                  |
      | as: reader-session                         |                  |
      | method: POST                               | code: 200        |+
      | path: /auth/refresh                        |                  |
      | payload:                                   |                  |
      |   mode: session                            |                  |
      | as: reader-session                         |                  |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_activity        | 0      | 1      | 0      | 0      |
      | 1       | directus_sessions        | 0      | 1      | 0      | 1      |
      | 1       | directus_settings        | 1      | 0      | 0      | 0      |
      | 1       | directus_users           | 2      | 0      | 1      | 0      |
      | 2       | directus_sessions        | 1      | 0      | 0      | 0      |
      | 2       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 3       | directus_sessions        | 1      | 0      | 0      | 0      |
      | 3       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 4       | directus_sessions        | 2      | 1      | 1      | 1      |
      | 4       | directus_users           | 0      | 0      | 1      | 0      |

  Scenario: an admin lists the published articles with their author over GraphQL
    When these requests get these responses:
      | request                                       | response                      |
      | method: POST                                  | code: 200                     |+
      | path: /graphql                                | body:                         |
      | payload:                                      |   data:                       |
      |   query: >-                                   |     test_read_counts_article: |
      |     { test_read_counts_article(               |       - title: First          |
      |     filter: { status: { _eq: "published" } }, |         author:               |
      |     sort: ["title"]) {                        |           name: Ada           |
      |     title author { name } } }                 |       - title: Second         |
      |                                               |         author:               |
      |                                               |           name: Bob           |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_author  | 1      | 0      | 0      | 0      |

  Scenario: an admin reads one article through every kind of relation over GraphQL
    When these requests get these responses:
      | request                               | response                            |
      | method: POST                          | code: 200                           |+
      | path: /graphql                        | body:                               |
      | payload:                              |   data:                             |
      |   query: >-                           |     test_read_counts_article_by_id: |
      |     { test_read_counts_article_by_id( |       title: First                  |
      |     id: "first") {                    |       author:                       |
      |     title author { name }             |         name: Ada                   |
      |     comments(sort: ["body"]) { body } |       comments:                     |
      |     tags(sort: ["id"]) {              |         - body: More                |
      |     test_read_counts_tag_id {         |         - body: Nice                |
      |     name } }                          |       tags:                         |
      |     blocks { item {                   |         - test_read_counts_tag_id:  |
      |     ... on test_read_counts_quote {   |             name: Perf              |
      |     text } } } } }                    |         - test_read_counts_tag_id:  |
      |                                       |             name: SQL               |
      |                                       |       blocks:                       |
      |                                       |         - item:                     |
      |                                       |             text: Measure first     |
    And on postgres the requests ran these statements:
      | request | table                          | select | insert | update | delete |
      | 1       | directus_users                 | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article       | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article_block | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article_tag   | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_author        | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_comment       | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_quote         | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_tag           | 1      | 0      | 0      | 0      |

  Scenario: a user whose policy filters the articles lists them over GraphQL, twice
    When these requests get these responses:
      | request                                       | response                      |
      | method: POST                                  | code: 200                     |+
      | path: /graphql                                | body:                         |
      | payload:                                      |   data:                       |
      |   query: >-                                   |     test_read_counts_article: |
      |     { test_read_counts_article(               |       - title: First          |
      |     filter: { status: { _eq: "published" } }, |         author:               |
      |     sort: ["title"]) {                        |           name: Ada           |
      |     title author { name } } }                 |       - title: Second         |
      | token: ReadStatementCountsToken               |         author:               |
      |                                               |           name: Bob           |
      | method: POST                                  | code: 200                     |+
      | path: /graphql                                | body:                         |
      | payload:                                      |   data:                       |
      |   query: >-                                   |     test_read_counts_article: |
      |     { test_read_counts_article(               |       - title: First          |
      |     filter: { status: { _eq: "published" } }, |         author:               |
      |     sort: ["title"]) {                        |           name: Ada           |
      |     title author { name } } }                 |       - title: Second         |
      | token: ReadStatementCountsToken               |         author:               |
      |                                               |           name: Bob           |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_permissions     | 3      | 0      | 0      | 0      |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_author  | 1      | 0      | 0      | 0      |
      | 2       | directus_users           | 1      | 0      | 0      | 0      |
      | 2       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 2       | test_read_counts_author  | 1      | 0      | 0      | 0      |

  Scenario: an admin opens the app
    When these requests get these responses:
      | request                    | response  |
      | method: GET                | code: 200 |+
      | path: /users/me            |           |
      | method: GET                | code: 200 |+
      | path: /server/info         |           |
      | method: GET                | code: 200 |+
      | path: /settings            |           |
      | method: GET                | code: 200 |+
      | path: /collections         |           |
      | method: GET                | code: 200 |+
      | path: /fields              |           |
      | method: GET                | code: 200 |+
      | path: /relations           |           |
      | method: GET                | code: 200 |+
      | path: /permissions/me      |           |
      | method: GET                | code: 200 |+
      | path: /policies/me/globals |           |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_access      | 1      | 0      | 0      | 0      |
      | 1       | directus_users       | 2      | 0      | 0      | 0      |
      | 2       | directus_files       | 1      | 0      | 0      | 0      |
      | 2       | directus_settings    | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 3       | directus_settings    | 1      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | directus_collections | 1      | 0      | 0      | 0      |
      | 4       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | pg_class             | 1      | 0      | 0      | 0      |
      | 5       | directus_fields      | 2      | 0      | 0      | 0      |
      | 5       | directus_users       | 1      | 0      | 0      | 0      |
      | 5       | geometry_columns     | 0      | 0      | 0      | 0      |
      | 5       | pg_attribute         | 1      | 0      | 0      | 0      |
      | 5       | pg_depend            | 1      | 0      | 0      | 0      |
      | 5       | pg_proc              | 1      | 0      | 0      | 0      |
      | 5       | undefined            | 0      | 0      | 0      | 0      |
      | 6       | directus_relations   | 1      | 0      | 0      | 0      |
      | 6       | directus_users       | 1      | 0      | 0      | 0      |
      | 6       | pg_constraint        | 1      | 0      | 0      | 0      |
      | 7       | directus_users       | 1      | 0      | 0      | 0      |
      | 8       | directus_access      | 1      | 0      | 0      | 0      |
      | 8       | directus_policies    | 2      | 0      | 0      | 0      |
      | 8       | directus_users       | 1      | 0      | 0      | 0      |

  Scenario: a user whose policy filters the articles opens the app
    When these requests get these responses:
      | request                         | response  |
      | method: GET                     | code: 200 |+
      | path: /users/me                 |           |
      | token: ReadStatementCountsToken |           |
      | method: GET                     | code: 200 |+
      | path: /server/info              |           |
      | token: ReadStatementCountsToken |           |
      | method: GET                     | code: 200 |+
      | path: /settings                 |           |
      | token: ReadStatementCountsToken |           |
      | method: GET                     | code: 200 |+
      | path: /collections              |           |
      | token: ReadStatementCountsToken |           |
      | method: GET                     | code: 200 |+
      | path: /fields                   |           |
      | token: ReadStatementCountsToken |           |
      | method: GET                     | code: 200 |+
      | path: /relations                |           |
      | token: ReadStatementCountsToken |           |
      | method: GET                     | code: 200 |+
      | path: /permissions/me           |           |
      | token: ReadStatementCountsToken |           |
      | method: GET                     | code: 200 |+
      | path: /policies/me/globals      |           |
      | token: ReadStatementCountsToken |           |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_permissions | 1      | 0      | 0      | 0      |
      | 1       | directus_users       | 2      | 0      | 0      | 0      |
      | 2       | directus_files       | 1      | 0      | 0      | 0      |
      | 2       | directus_settings    | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 3       | directus_permissions | 1      | 0      | 0      | 0      |
      | 3       | directus_settings    | 1      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | directus_collections | 1      | 0      | 0      | 0      |
      | 4       | directus_permissions | 1      | 0      | 0      | 0      |
      | 4       | directus_users       | 1      | 0      | 0      | 0      |
      | 4       | pg_class             | 1      | 0      | 0      | 0      |
      | 5       | directus_fields      | 2      | 0      | 0      | 0      |
      | 5       | directus_permissions | 1      | 0      | 0      | 0      |
      | 5       | directus_users       | 1      | 0      | 0      | 0      |
      | 6       | directus_permissions | 1      | 0      | 0      | 0      |
      | 6       | directus_relations   | 1      | 0      | 0      | 0      |
      | 6       | directus_users       | 1      | 0      | 0      | 0      |
      | 7       | directus_permissions | 1      | 0      | 0      | 0      |
      | 7       | directus_users       | 1      | 0      | 0      | 0      |
      | 8       | directus_policies    | 1      | 0      | 0      | 0      |
      | 8       | directus_users       | 1      | 0      | 0      | 0      |

  Scenario: an admin and a user whose policy filters the articles count them while listing
    When these requests get these responses:
      | request                               | response            |
      | method: GET                           | code: 200           |+
      | path: /items/test_read_counts_article | body:               |
      | query:                                |   meta:             |
      |   filter[status][_eq]: published      |     filter_count: 2 |
      |   fields: id                          |     total_count: 3  |
      |   meta: [filter_count, total_count]   |                     |
      | method: GET                           | code: 200           |+
      | path: /items/test_read_counts_article | body:               |
      | query:                                |   meta:             |
      |   filter[status][_eq]: published      |     filter_count: 2 |
      |   fields: id                          |                     |
      |   meta: [filter_count, total_count]   |                     |
      | token: ReadStatementCountsToken       |                     |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 3      | 0      | 0      | 0      |
      | 2       | directus_users           | 1      | 0      | 0      | 0      |
      | 2       | test_read_counts_article | 3      | 0      | 0      | 0      |

  Scenario: an admin and a user whose policy filters the articles search them
    When these requests get these responses:
      | request                               | response        |
      | method: GET                           | code: 200       |+
      | path: /items/test_read_counts_article | body:           |
      | query:                                |   data:         |
      |   search: Fir                         |     - id: first |
      |   fields: id                          |                 |
      | method: GET                           | code: 200       |+
      | path: /items/test_read_counts_article | body:           |
      | query:                                |   data:         |
      |   search: Fir                         |     - id: first |
      |   fields: id                          |                 |
      | token: ReadStatementCountsToken       |                 |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_read_counts_article | 1      | 0      | 0      | 0      |
      | 2       | directus_users           | 1      | 0      | 0      | 0      |
      | 2       | test_read_counts_article | 1      | 0      | 0      | 0      |

  Scenario: an admin and a user whose policy reads the files download one
    When these requests get these responses:
      | request                                            | response  |
      | method: GET                                        | code: 200 |+
      | path: /assets/4f6c2a9e-1b3d-4c8e-9a7f-2d5e8b1c0a63 |           |
      | method: GET                                        | code: 200 |+
      | path: /assets/4f6c2a9e-1b3d-4c8e-9a7f-2d5e8b1c0a63 |           |
      | token: ReadStatementCountsToken                    |           |
    And on postgres the requests ran these statements:
      | request | table | select | insert | update | delete |
      | 1       | -     | 0      | 0      | 0      | 0      |
      | 2       | -     | 0      | 0      | 0      | 0      |
