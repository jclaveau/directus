Feature: A read joins the relation a permission case filters on

  - `test_mixed_cases_article` points at `test_mixed_cases_author` through the
    m2o field `author`.
  - `ReadMixedPermissionCasesToken` is a user with two policies: one reads
    every article's `id` and `title`, the other an article's `secret` only
    where its author's `status` is `published`.
  - A Given creates its table's rows in one request as the admin; an empty
    cell is null. A request authenticates with its `token`. A response cell
    states the keys it checks; every key is a string the scenario chooses.

  Scenario: a field granted through a relation reads beside fields granted on every row
    Given the rows of test_mixed_cases_author:
      | id     | status    |
      | mc-pub | published |
      | mc-dft | draft     |
    And their children in test_mixed_cases_article:
      | id   | title | secret | author |
      | mc-a | A     | sa     | mc-pub |
      | mc-b | B     | sb     | mc-dft |
    When these requests get these responses:
      | request                               | response           |
      | method: GET                           | code: 200          |+
      | path: /items/test_mixed_cases_article | body:              |
      | token: ReadMixedPermissionCasesToken  |   data:            |
      | query:                                |     - id: mc-a     |
      |   fields: id,title,secret             |       title: A     |
      |   filter[id][_starts_with]: mc-       |       secret: sa   |
      |   sort: id                            |     - id: mc-b     |
      |                                       |       title: B     |
      |                                       |       secret: null |
