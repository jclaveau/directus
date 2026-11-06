Feature: A permission rule and a user read an o2m quantifier the same way

  - `test_quantifier_perm_article` lists its `test_quantifier_perm_link` rows
    through the o2m field `links`.
  - A request authenticates as the admin, or with the token its `as` cell holds.
    `<run>` stands for a value unique to the scenario, and any other `<name>`
    for a uuid of its own. A response cell states the keys it checks.

  Scenario: a rule with a _some on two conditions grants a parent one link meets both
    Given these requests are sent:
      | request                                        | response  |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_article      |           |
      | payload:                                       |           |
      |   - id: <run>-a                                |           |
      |   - id: <run>-b                                |           |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_link         |           |
      | payload:                                       |           |
      |   - id: <run>-a1                               |           |
      |     article: <run>-a                           |           |
      |     name: a                                    |           |
      |     status: x                                  |           |
      |   - id: <run>-a2                               |           |
      |     article: <run>-a                           |           |
      |     name: y                                    |           |
      |     status: b                                  |           |
      |   - id: <run>-b1                               |           |
      |     article: <run>-b                           |           |
      |     name: a                                    |           |
      |     status: b                                  |           |
      | method: POST                                   | code: 200 |+
      | path: /policies                                |           |
      | payload:                                       |           |
      |   id: <reader-policy>                          |           |
      |   name: qp-<run>                               |           |
      |   app_access: false                            |           |
      |   admin_access: false                          |           |
      |   permissions:                                 |           |
      |     - collection: test_quantifier_perm_article |           |
      |       action: read                             |           |
      |       fields:                                  |           |
      |         - id                                   |           |
      |       permissions:                             |           |
      |         links:                                 |           |
      |           _some:                               |           |
      |             name:                              |           |
      |               _eq: a                           |           |
      |             status:                            |           |
      |               _eq: b                           |           |
      |     - collection: test_quantifier_perm_link    |           |
      |       action: read                             |           |
      |       fields:                                  |           |
      |         - '*'                                  |           |
      |       permissions: {}                          |           |
      | method: POST                                   | code: 200 |+
      | path: /users                                   |           |
      | payload:                                       |           |
      |   email: qp-<run>@example.com                  |           |
      |   token: <reader-token>                        |           |
      |   policies:                                    |           |
      |     - policy: <reader-policy>                  |           |
    Then these requests get these responses:
      | request                                   | response          |
      | as: <reader-token>                        | code: 200         |+
      | method: GET                               | body:             |
      | path: /items/test_quantifier_perm_article |   data:           |
      | query:                                    |     - id: <run>-b |
      |   fields: id                              |                   |
      |   sort: id                                |                   |
      |   filter[id][_starts_with]: <run>-        |                   |

  Scenario: a rule with a _none on two conditions hides a parent one link meets both
    Given these requests are sent:
      | request                                        | response  |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_article      |           |
      | payload:                                       |           |
      |   - id: <run>-a                                |           |
      |   - id: <run>-b                                |           |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_link         |           |
      | payload:                                       |           |
      |   - id: <run>-a1                               |           |
      |     article: <run>-a                           |           |
      |     name: a                                    |           |
      |     status: x                                  |           |
      |   - id: <run>-a2                               |           |
      |     article: <run>-a                           |           |
      |     name: y                                    |           |
      |     status: b                                  |           |
      |   - id: <run>-b1                               |           |
      |     article: <run>-b                           |           |
      |     name: a                                    |           |
      |     status: b                                  |           |
      | method: POST                                   | code: 200 |+
      | path: /policies                                |           |
      | payload:                                       |           |
      |   id: <reader-policy>                          |           |
      |   name: qp-<run>                               |           |
      |   app_access: false                            |           |
      |   admin_access: false                          |           |
      |   permissions:                                 |           |
      |     - collection: test_quantifier_perm_article |           |
      |       action: read                             |           |
      |       fields:                                  |           |
      |         - id                                   |           |
      |       permissions:                             |           |
      |         links:                                 |           |
      |           _none:                               |           |
      |             name:                              |           |
      |               _eq: a                           |           |
      |             status:                            |           |
      |               _eq: b                           |           |
      |     - collection: test_quantifier_perm_link    |           |
      |       action: read                             |           |
      |       fields:                                  |           |
      |         - '*'                                  |           |
      |       permissions: {}                          |           |
      | method: POST                                   | code: 200 |+
      | path: /users                                   |           |
      | payload:                                       |           |
      |   email: qp-<run>@example.com                  |           |
      |   token: <reader-token>                        |           |
      |   policies:                                    |           |
      |     - policy: <reader-policy>                  |           |
    Then these requests get these responses:
      | request                                   | response          |
      | as: <reader-token>                        | code: 200         |+
      | method: GET                               | body:             |
      | path: /items/test_quantifier_perm_article |   data:           |
      | query:                                    |     - id: <run>-a |
      |   fields: id                              |                   |
      |   sort: id                                |                   |
      |   filter[id][_starts_with]: <run>-        |                   |

  Scenario: a _some with no condition filters nothing and reads no relation
    Given these requests are sent:
      | request                                        | response  |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_article      |           |
      | payload:                                       |           |
      |   - id: <run>-a                                |           |
      |   - id: <run>-b                                |           |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_link         |           |
      | payload:                                       |           |
      |   - id: <run>-a1                               |           |
      |     article: <run>-a                           |           |
      |     name: a                                    |           |
      |     status: x                                  |           |
      | method: POST                                   | code: 200 |+
      | path: /policies                                |           |
      | payload:                                       |           |
      |   id: <reader-policy>                          |           |
      |   name: qp-<run>                               |           |
      |   app_access: false                            |           |
      |   admin_access: false                          |           |
      |   permissions:                                 |           |
      |     - collection: test_quantifier_perm_article |           |
      |       action: read                             |           |
      |       fields:                                  |           |
      |         - id                                   |           |
      |       permissions:                             |           |
      |         id:                                    |           |
      |           _starts_with: <run>-                 |           |
      | method: POST                                   | code: 200 |+
      | path: /users                                   |           |
      | payload:                                       |           |
      |   email: qp-<run>@example.com                  |           |
      |   token: <reader-token>                        |           |
      |   policies:                                    |           |
      |     - policy: <reader-policy>                  |           |
    Then these requests get these responses:
      | request                                     | response          |
      | as: <reader-token>                          | code: 200         |+
      | method: GET                                 | body:             |
      | path: /items/test_quantifier_perm_article   |   data:           |
      | query:                                      |     - id: <run>-a |
      |   fields: id                                |     - id: <run>-b |
      |   sort: id                                  |                   |
      |   filter: '{"links":{"_some":{"_and":[]}}}' |                   |
      | as: <reader-token>                          | code: 403         |+
      | method: GET                                 |                   |
      | path: /items/test_quantifier_perm_article   |                   |
      | query:                                      |                   |
      |   fields: id                                |                   |
      |   filter[links][_some][name][_eq]: a        |                   |

  Scenario: a _none with no condition filters nothing and reads no relation
    Given these requests are sent:
      | request                                        | response  |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_article      |           |
      | payload:                                       |           |
      |   - id: <run>-a                                |           |
      |   - id: <run>-b                                |           |
      | method: POST                                   | code: 200 |+
      | path: /items/test_quantifier_perm_link         |           |
      | payload:                                       |           |
      |   - id: <run>-a1                               |           |
      |     article: <run>-a                           |           |
      |     name: a                                    |           |
      |     status: x                                  |           |
      | method: POST                                   | code: 200 |+
      | path: /policies                                |           |
      | payload:                                       |           |
      |   id: <reader-policy>                          |           |
      |   name: qp-<run>                               |           |
      |   app_access: false                            |           |
      |   admin_access: false                          |           |
      |   permissions:                                 |           |
      |     - collection: test_quantifier_perm_article |           |
      |       action: read                             |           |
      |       fields:                                  |           |
      |         - id                                   |           |
      |       permissions:                             |           |
      |         id:                                    |           |
      |           _starts_with: <run>-                 |           |
      | method: POST                                   | code: 200 |+
      | path: /users                                   |           |
      | payload:                                       |           |
      |   email: qp-<run>@example.com                  |           |
      |   token: <reader-token>                        |           |
      |   policies:                                    |           |
      |     - policy: <reader-policy>                  |           |
    Then these requests get these responses:
      | request                                     | response          |
      | as: <reader-token>                          | code: 200         |+
      | method: GET                                 | body:             |
      | path: /items/test_quantifier_perm_article   |   data:           |
      | query:                                      |     - id: <run>-a |
      |   fields: id                                |     - id: <run>-b |
      |   sort: id                                  |                   |
      |   filter: '{"links":{"_none":{"_and":[]}}}' |                   |
