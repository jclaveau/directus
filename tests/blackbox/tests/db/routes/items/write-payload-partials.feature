Feature: A write takes the less travelled side of each payload rule

  - `test_wpp_row` is keyed by strings the scenarios choose: `answer` is a
    string read through cast-boolean, `role_made` and `role_changed` record
    a role, `spot` is a geometry point, `day` a date, `moment` a dateTime.
  - `test_wpp_parent.children` lists `test_wpp_child` rows. A child names
    one `test_wpp_leaf` through the any-to-one `target`, lists leaves under
    `leaves` (a leaf left out is deleted) and notes under `notes` (a note
    left out is unlinked).
  - `test_wpp_generated` is keyed by a uuid the database draws.
  - A request authenticates as the admin, or as the static token `as` names.
    `<run>` stands for a value unique to the scenario, and any other `<name>`
    for a uuid of its own, or for the key a `remember: name` row stored. A
    response cell states the keys it checks.

  Scenario: a cast-boolean string reads as a boolean only when it holds one
    Then these requests get these responses:
      | request                   | response          |
      | method: POST              | code: 200         |+
      | path: /items/test_wpp_row | body:             |
      | payload:                  |   data:           |
      |   id: maybe-<run>         |     answer: maybe |
      |   answer: maybe           |                   |
      | method: POST              | code: 200         |+
      | path: /items/test_wpp_row | body:             |
      | payload:                  |   data:           |
      |   id: empty-<run>         |     answer: null  |
      |   answer: ''              |                   |
      | method: POST              | code: 200         |+
      | path: /items/test_wpp_row | body:             |
      | payload:                  |   data:           |
      |   id: one-<run>           |     answer: true  |
      |   answer: '1'             |                   |

  Scenario: a user of no role records no role on the rows it writes
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /policies                     |           |
      | payload:                            |           |
      |   id: <roleless-policy>             |           |
      |   name: roleless-<run>              |           |
      |   admin_access: true                |           |
      | method: POST                        | code: 200 |+
      | path: /users                        |           |
      | payload:                            |           |
      |   id: <roleless-user>               |           |
      |   email: roleless-<run>@example.com |           |
      |   token: roleless-<run>             |           |
      | method: POST                        | code: 200 |+
      | path: /access                       |           |
      | payload:                            |           |
      |   user: <roleless-user>             |           |
      |   policy: <roleless-policy>         |           |
    Then these requests get these responses:
      | request                                  | response               |
      | method: POST                             | code: 200              |+
      | path: /items/test_wpp_row                | body:                  |
      | as: roleless-<run>                       |   data:                |
      | payload:                                 |     role_made: null    |
      |   id: roleless-<run>                     |     role_changed: null |
      | method: PATCH                            | code: 200              |+
      | path: /items/test_wpp_row/roleless-<run> | body:                  |
      | as: roleless-<run>                       |   data:                |
      | payload:                                 |     role_made: null    |
      |   answer: 'true'                         |     role_changed: null |

  Scenario: a point written as a GeoJSON string or as null reads back as written
    Then these requests get these responses:
      | request                                  | response           |
      | method: POST                             | code: 200          |+
      | path: /items/test_wpp_row                | body:              |
      | payload:                                 |   data:            |
      |   id: text-spot-<run>                    |     spot:          |
      |   spot: >-                               |       type: Point  |
      |     {"type":"Point","coordinates":[5,6]} |       coordinates: |
      |                                          |         - 5        |
      |                                          |         - 6        |
      | method: POST                             | code: 200          |+
      | path: /items/test_wpp_row                | body:              |
      | payload:                                 |   data:            |
      |   id: no-spot-<run>                      |     spot: null     |
      |   spot: null                             |                    |

  Scenario: a date and a dateTime written as valid strings read back as written
    Then these requests get these responses:
      | request                         | response                          |
      | method: POST                    | code: 200                         |+
      | path: /items/test_wpp_row       | body:                             |
      | payload:                        |   data:                           |
      |   id: dated-<run>               |     day: '2026-03-04'             |
      |   day: '2026-03-04'             |     moment: '2026-03-04T05:06:07' |
      |   moment: '2026-03-04T05:06:07' |                                   |

  Scenario: a nested child creates, updates or keeps the leaf it targets
    Given these requests are sent:
      | request                    | response  |
      | method: POST               | code: 200 |+
      | path: /items/test_wpp_leaf |           |
      | payload:                   |           |
      |   name: kept-<run>         |           |
      | remember: leaf             |           |
    Then these requests get these responses:
      | request                                | response                  |
      | method: POST                           | code: 200                 |+
      | path: /items/test_wpp_parent           |                           |
      | payload:                               |                           |
      |   name: parent-<run>                   |                           |
      |   children:                            |                           |
      |     - name: creating-<run>             |                           |
      |       target_collection: test_wpp_leaf |                           |
      |       target:                          |                           |
      |         name: created-<run>            |                           |
      |     - name: updating-<run>             |                           |
      |       target_collection: test_wpp_leaf |                           |
      |       target:                          |                           |
      |         id: <leaf>                     |                           |
      |         name: renamed-<run>            |                           |
      |     - name: keeping-<run>              |                           |
      |       target_collection: test_wpp_leaf |                           |
      |       target: '<leaf>'                 |                           |
      | method: GET                            | code: 200                 |+
      | path: /items/test_wpp_leaf             | body:                     |
      | query:                                 |   data:                   |
      |   fields: name                         |     - name: created-<run> |
      |   filter[name][_eq]: created-<run>     |                           |
      | method: GET                            | code: 200                 |+
      | path: /items/test_wpp_leaf/<leaf>      | body:                     |
      | query:                                 |   data:                   |
      |   fields: name                         |     name: renamed-<run>   |
      | method: GET                            | code: 200                 |+
      | path: /items/test_wpp_child            | body:                     |
      | query:                                 |   data:                   |
      |   fields: target                       |     - target: '<leaf>'    |
      |   filter[name][_eq]: keeping-<run>     |                           |

  Scenario: a nested child drops the leaves and notes it no longer lists
    Given these requests are sent:
      | request                      | response  |
      | method: POST                 | code: 200 |+
      | path: /items/test_wpp_parent |           |
      | payload:                     |           |
      |   name: parent-<run>         |           |
      | remember: parent             |           |
      | method: POST                 | code: 200 |+
      | path: /items/test_wpp_leaf   |           |
      | payload:                     |           |
      |   name: kept-leaf-<run>      |           |
      | remember: kept-leaf          |           |
      | method: POST                 | code: 200 |+
      | path: /items/test_wpp_leaf   |           |
      | payload:                     |           |
      |   name: dropped-leaf-<run>   |           |
      | remember: dropped-leaf       |           |
      | method: POST                 | code: 200 |+
      | path: /items/test_wpp_note   |           |
      | payload:                     |           |
      |   name: kept-note-<run>      |           |
      | remember: kept-note          |           |
      | method: POST                 | code: 200 |+
      | path: /items/test_wpp_note   |           |
      | payload:                     |           |
      |   name: dropped-note-<run>   |           |
      | remember: dropped-note       |           |
      | method: POST                 | code: 200 |+
      | path: /items/test_wpp_child  |           |
      | payload:                     |           |
      |   name: child-<run>          |           |
      |   parent: <parent>           |           |
      |   leaves:                    |           |
      |     - <kept-leaf>            |           |
      |     - <dropped-leaf>         |           |
      |   notes:                     |           |
      |     - <kept-note>            |           |
      |     - <dropped-note>         |           |
      | remember: child              |           |
    Then these requests get these responses:
      | request                                   | response                 |
      | method: PATCH                             | code: 200                |+
      | path: /items/test_wpp_parent/<parent>     |                          |
      | payload:                                  |                          |
      |   children:                               |                          |
      |     - id: <child>                         |                          |
      |       leaves:                             |                          |
      |         - <kept-leaf>                     |                          |
      |       notes:                              |                          |
      |         - <kept-note>                     |                          |
      | method: GET                               | code: 200                |+
      | path: /items/test_wpp_leaf                | body:                    |
      | query:                                    |   data:                  |
      |   fields: id                              |     - id: <kept-leaf>    |
      |   filter[child][_eq]: '<child>'           |                          |
      | method: GET                               | code: 404                |+
      | path: /items/test_wpp_leaf/<dropped-leaf> | body:                    |
      |                                           |   errors:                |
      |                                           |     - message: >-        |
      |                                           |         Item             |
      |                                           |         "<dropped-leaf>" |
      |                                           |         doesn't exist    |
      |                                           |         in collection    |
      |                                           |         "test_wpp_leaf". |
      | method: GET                               | code: 200                |+
      | path: /items/test_wpp_note/<dropped-note> | body:                    |
      | query:                                    |   data:                  |
      |   fields: child                           |     child: null          |
      | method: GET                               | code: 200                |+
      | path: /items/test_wpp_note/<kept-note>    | body:                    |
      | query:                                    |   data:                  |
      |   fields: child                           |     child: <child>       |

  Scenario: a row keyed by a uuid the database draws reads back under it
    Then these requests get these responses:
      | request                         | response                  |
      | method: POST                    | code: 200                 |+
      | path: /items/test_wpp_generated | body:                     |
      | query:                          |   data:                   |
      |   sort: label                   |     - label: first-<run>  |
      | payload:                        |     - label: second-<run> |
      |   - label: first-<run>          |                           |
      |   - label: second-<run>         |                           |
      | method: POST                    | code: 200                 |+
      | path: /items/test_wpp_generated | body:                     |
      | payload:                        |   data:                   |
      |   label: single-<run>           |     label: single-<run>   |
