Feature: A read joins the relation a permission case filters on

  - `test_mixed_cases_article` points at `test_mixed_cases_author` through the
    m2o field `author`.
  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a field granted through a relation reads beside fields granted on every row
    Given these requests are sent:
      | request                                    | response  |
      | method: POST                               | code: 200 |+
      | path: /items/test_mixed_cases_author       |           |
      | payload:                                   |           |
      |   - id: <run>-pub                          |           |
      |     status: published                      |           |
      |   - id: <run>-dft                          |           |
      |     status: draft                          |           |
      | method: POST                               | code: 200 |+
      | path: /items/test_mixed_cases_article      |           |
      | payload:                                   |           |
      |   - id: <run>-a                            |           |
      |     title: A                               |           |
      |     secret: sa                             |           |
      |     author: <run>-pub                      |           |
      |   - id: <run>-b                            |           |
      |     title: B                               |           |
      |     secret: sb                             |           |
      |     author: <run>-dft                      |           |
      | method: POST                               | code: 200 |+
      | path: /policies                            |           |
      | payload:                                   |           |
      |   id: <open-policy>                        |           |
      |   name: mc-open-<run>                      |           |
      |   app_access: false                        |           |
      |   admin_access: false                      |           |
      |   permissions:                             |           |
      |     - collection: test_mixed_cases_article |           |
      |       action: read                         |           |
      |       fields: [id, title]                  |           |
      |       permissions: {}                      |           |
      |     - collection: test_mixed_cases_author  |           |
      |       action: read                         |           |
      |       fields: ['*']                        |           |
      |       permissions: {}                      |           |
      | method: POST                               | code: 200 |+
      | path: /policies                            |           |
      | payload:                                   |           |
      |   id: <author-policy>                      |           |
      |   name: mc-author-<run>                    |           |
      |   app_access: false                        |           |
      |   admin_access: false                      |           |
      |   permissions:                             |           |
      |     - collection: test_mixed_cases_article |           |
      |       action: read                         |           |
      |       fields: [secret]                     |           |
      |       permissions:                         |           |
      |         author:                            |           |
      |           status:                          |           |
      |             _eq: published                 |           |
      | method: POST                               | code: 200 |+
      | path: /users                               |           |
      | payload:                                   |           |
      |   email: mc-<run>@example.com              |           |
      |   token: <reader-token>                    |           |
      |   policies:                                |           |
      |     - policy: <open-policy>                |           |
      |     - policy: <author-policy>              |           |
    Then these requests get these responses:
      | request                               | response           |
      | as: <reader-token>                    | code: 200          |+
      | method: GET                           | body:              |
      | path: /items/test_mixed_cases_article |   data:            |
      | query:                                |     - id: <run>-a  |
      |   fields: id,title,secret             |       title: A     |
      |   filter[id][_starts_with]: <run>-    |       secret: sa   |
      |   sort: id                            |     - id: <run>-b  |
      |                                       |       title: B     |
      |                                       |       secret: null |
