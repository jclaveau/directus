Feature: A nested many-to-one or any-to-one object writes its related row

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list under
    `query` is sent joined by commas. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - Every collection keeps its revisions. `test_nested_m2o_card.owner` is a
    many-to-one to `test_nested_m2o_owner`, `test_nested_m2o_task.assignee` one
    to `directus_users`. `test_nested_a2o_link.item` is an any-to-one to
    `test_nested_a2o_page` or `test_nested_a2o_post`, named by
    `test_nested_a2o_link.target_collection`. `test_batch_uuid_badge` is keyed
    by uuid.
  - Every request goes to an instance of the feature's own, sharing the
    database, that reports the statements each request ran
    (`QUERY_AUDIT_HEADER`). The last step counts a request's statements per
    table and kind, on postgres alone: other vendors run other statements.
  - Those counts are the baseline before the batched writes of #414, which
    are expected to drop them.

  Scenario: a nested M2O object naming an existing row with fields updates it
    When these requests get these responses:
      | request                            | response          |
      | method: POST                       | code: 200         |+
      | path: /items/test_nested_m2o_owner |                   |
      | payload:                           |                   |
      |   id: own-u                        |                   |
      |   name: before                     |                   |
      | method: POST                       | code: 200         |+
      | path: /items/test_nested_m2o_card  | body:             |
      | query:                             |   data:           |
      |   fields:                          |     id: card-u    |
      |     - id                           |     owner:        |
      |     - owner.name                   |       name: after |
      | payload:                           |                   |
      |   id: card-u                       |                   |
      |   owner:                           |                   |
      |     id: own-u                      |                   |
      |     name: after                    |                   |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 2       | directus_activity     | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions    | 0      | 2      | 1      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | test_nested_m2o_card  | 1      | 1      | 0      | 0      |
      | 2       | test_nested_m2o_owner | 4      | 0      | 1      | 0      |

  Scenario: a nested M2O object naming an existing row alone leaves it unwritten
    When these requests get these responses:
      | request                            | response               |
      | method: POST                       | code: 200              |+
      | path: /items/test_nested_m2o_owner |                        |
      | payload:                           |                        |
      |   id: own-k                        |                        |
      |   name: kept                       |                        |
      | method: POST                       | code: 200              |+
      | path: /items/test_nested_m2o_card  | body:                  |
      | query:                             |   data:                |
      |   fields:                          |     owner:             |
      |     - owner.name                   |       name: kept       |
      | payload:                           |                        |
      |   id: card-k                       |                        |
      |   owner:                           |                        |
      |     id: own-k                      |                        |
      | method: GET                        | code: 200              |+
      | path: /revisions                   | body:                  |
      | query:                             |   data:                |
      |   filter[item][_eq]: own-k         |     - activity:        |
      |   fields:                          |         action: create |
      |     - activity.action              |       item: own-k      |
      |     - item                         |                        |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 2       | directus_activity     | 0      | 1      | 0      | 0      |
      | 2       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 2       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | test_nested_m2o_card  | 1      | 1      | 0      | 0      |
      | 2       | test_nested_m2o_owner | 2      | 0      | 0      | 0      |

  Scenario: a PATCH carrying a nested M2O object updates or creates its row
    When these requests get these responses:
      | request                                  | response          |
      | method: POST                             | code: 200         |+
      | path: /items/test_nested_m2o_owner       |                   |
      | payload:                                 |                   |
      |   id: own-p                              |                   |
      |   name: before                           |                   |
      | method: POST                             | code: 200         |+
      | path: /items/test_nested_m2o_card        |                   |
      | payload:                                 |                   |
      |   id: card-p                             |                   |
      | method: PATCH                            | code: 200         |+
      | path: /items/test_nested_m2o_card/card-p | body:             |
      | query:                                   |   data:           |
      |   fields:                                |     owner:        |
      |     - owner.id                           |       id: own-p   |
      |     - owner.name                         |       name: after |
      | payload:                                 |                   |
      |   owner:                                 |                   |
      |     id: own-p                            |                   |
      |     name: after                          |                   |
      | method: PATCH                            | code: 200         |+
      | path: /items/test_nested_m2o_card/card-p | body:             |
      | query:                                   |   data:           |
      |   fields:                                |     owner:        |
      |     - owner.id                           |       id: own-q   |
      |     - owner.name                         |       name: fresh |
      | payload:                                 |                   |
      |   owner:                                 |                   |
      |     id: own-q                            |                   |
      |     name: fresh                          |                   |
      | method: GET                              | code: 200         |+
      | path: /items/test_nested_m2o_owner       | body:             |
      | query:                                   |   data:           |
      |   filter[id][_in]:                       |     - id: own-p   |
      |     - own-p                              |       name: after |
      |     - own-q                              |     - id: own-q   |
      |   sort: id                               |       name: fresh |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 3       | directus_activity     | 0      | 2      | 0      | 0      |
      | 3       | directus_revisions    | 0      | 2      | 1      | 0      |
      | 3       | directus_users        | 1      | 0      | 0      | 0      |
      | 3       | test_nested_m2o_card  | 3      | 0      | 1      | 0      |
      | 3       | test_nested_m2o_owner | 4      | 0      | 1      | 0      |
      | 4       | directus_activity     | 0      | 2      | 0      | 0      |
      | 4       | directus_revisions    | 0      | 2      | 1      | 0      |
      | 4       | directus_users        | 1      | 0      | 0      | 0      |
      | 4       | test_nested_m2o_card  | 3      | 0      | 1      | 0      |
      | 4       | test_nested_m2o_owner | 2      | 1      | 0      | 0      |

  Scenario: a PATCH of several keys files each revision under its own row
    When these requests get these responses:
      | request                                 | response               |
      | method: POST                            | code: 200              |+
      | path: /items/test_nested_m2o_owner      |                        |
      | payload:                                |                        |
      |   id: own-r                             |                        |
      |   name: before                          |                        |
      | method: POST                            | code: 200              |+
      | path: /items/test_nested_m2o_card       |                        |
      | payload:                                |                        |
      |   - id: rev-a                           |                        |
      |     note: kept a                        |                        |
      |   - id: rev-b                           |                        |
      |     note: kept b                        |                        |
      | method: PATCH                           | code: 200              |+
      | path: /items/test_nested_m2o_card       | body:                  |
      | query:                                  |   data:                |
      |   fields:                               |     - id: rev-a        |
      |     - id                                |       title: renamed   |
      |     - title                             |       owner:           |
      |     - owner.name                        |         name: after    |
      |   sort: id                              |     - id: rev-b        |
      | payload:                                |       title: renamed   |
      |   keys:                                 |       owner:           |
      |     - rev-b                             |         name: after    |
      |     - rev-a                             |                        |
      |   data:                                 |                        |
      |     title: renamed                      |                        |
      |     owner:                              |                        |
      |       id: own-r                         |                        |
      |       name: after                       |                        |
      | method: GET                             | code: 200              |+
      | path: /revisions                        | body:                  |
      | query:                                  |   data:                |
      |   filter[item][_in]:                    |     - item: own-r      |
      |     - own-r                             |       data:            |
      |     - rev-a                             |         id: own-r      |
      |     - rev-b                             |         name: after    |
      |   filter[activity][action][_eq]: update |       delta:           |
      |   fields:                               |         name: after    |
      |     - item                              |       parent:          |
      |     - data                              |         item: rev-a    |
      |     - delta                             |     - item: rev-a      |
      |     - parent.item                       |       data:            |
      |   sort: item                            |         id: rev-a      |
      |                                         |         note: kept a   |
      |                                         |         title: renamed |
      |                                         |         owner: own-r   |
      |                                         |       delta:           |
      |                                         |         title: renamed |
      |                                         |         owner: own-r   |
      |                                         |       parent: null     |
      |                                         |     - item: rev-b      |
      |                                         |       data:            |
      |                                         |         id: rev-b      |
      |                                         |         note: kept b   |
      |                                         |         title: renamed |
      |                                         |         owner: own-r   |
      |                                         |       delta:           |
      |                                         |         title: renamed |
      |                                         |         owner: own-r   |
      |                                         |       parent: null     |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 3       | directus_activity     | 0      | 2      | 0      | 0      |
      | 3       | directus_revisions    | 0      | 2      | 1      | 0      |
      | 3       | directus_users        | 1      | 0      | 0      | 0      |
      | 3       | test_nested_m2o_card  | 2      | 0      | 1      | 0      |
      | 3       | test_nested_m2o_owner | 4      | 0      | 1      | 0      |

  Scenario: a batch create files a nested row's revision under its carrier
    When these requests get these responses:
      | request                           | response               |
      | method: POST                      | code: 200              |+
      | path: /items/test_nested_m2o_card |                        |
      | payload:                          |                        |
      |   - id: bat-a                     |                        |
      |     title: a                      |                        |
      |     owner:                        |                        |
      |       id: own-b                   |                        |
      |       name: made                  |                        |
      |   - id: bat-b                     |                        |
      |     title: b                      |                        |
      | method: GET                       | code: 200              |+
      | path: /revisions                  | body:                  |
      | query:                            |   data:                |
      |   filter[item][_in]:              |     - activity:        |
      |     - bat-a                       |         action: create |
      |     - bat-b                       |       item: bat-a      |
      |     - own-b                       |       data:            |
      |   fields:                         |         id: bat-a      |
      |     - activity.action             |         title: a       |
      |     - item                        |         owner: own-b   |
      |     - data                        |       parent: null     |
      |     - parent.item                 |     - activity:        |
      |   sort: item                      |         action: create |
      |                                   |       item: bat-b      |
      |                                   |       data:            |
      |                                   |         id: bat-b      |
      |                                   |         title: b       |
      |                                   |       parent: null     |
      |                                   |     - activity:        |
      |                                   |         action: create |
      |                                   |       item: own-b      |
      |                                   |       data:            |
      |                                   |         id: own-b      |
      |                                   |         name: made     |
      |                                   |       parent:          |
      |                                   |         item: bat-a    |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_activity     | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 2      | 1      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 1       | test_nested_m2o_card  | 1      | 1      | 0      | 0      |
      | 1       | test_nested_m2o_owner | 1      | 1      | 0      | 0      |

  Scenario: a PATCH creating a user through an M2O passes the user checks
    When these requests get these responses:
      | request                                  | response                          |
      | method: POST                             | code: 200                         |+
      | path: /items/test_nested_m2o_task        |                                   |
      | payload:                                 |                                   |
      |   id: task-i                             |                                   |
      | method: PATCH                            | code: 200                         |+
      | path: /items/test_nested_m2o_task/task-i | body:                             |
      | query:                                   |   data:                           |
      |   fields:                                |     assignee:                     |
      |     - assignee.email                     |       email: m2o-user@example.com |
      |     - assignee.status                    |       status: active              |
      | payload:                                 |                                   |
      |   assignee:                              |                                   |
      |     email: m2o-user@example.com          |                                   |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 2       | directus_activity    | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions   | 0      | 2      | 1      | 0      |
      | 2       | directus_users       | 3      | 1      | 0      | 0      |
      | 2       | test_nested_m2o_task | 3      | 0      | 1      | 0      |

  Scenario: a nested A2O object without its collection field is refused
    When these requests get these responses:
      | request                           | response                      |
      | method: POST                      | code: 400                     |+
      | path: /items/test_nested_a2o_link | body:                         |
      | payload:                          |   errors:                     |
      |   id: lk-m                        |     - extensions:             |
      |   item:                           |         code: INVALID_PAYLOAD |
      |     id: pg-m                      |                               |
      |     title: lost                   |                               |
      | method: GET                       | code: 200                     |+
      | path: /items/test_nested_a2o_page | body:                         |
      | query:                            |   data: []                    |
      |   filter[id][_eq]: pg-m           |                               |
    Then response 1 is refused with the message:
      """
      Invalid payload. Can't update nested record "test_nested_a2o_link.item"
      without field "test_nested_a2o_link.target_collection" being set.
      """

  Scenario: a nested A2O object naming a collection it may not link to is refused
    When these requests get these responses:
      | request                            | response                      |
      | method: POST                       | code: 400                     |+
      | path: /items/test_nested_a2o_link  | body:                         |
      | payload:                           |   errors:                     |
      |   id: lk-x                         |     - extensions:             |
      |   target_collection: >-            |         code: INVALID_PAYLOAD |
      |     test_nested_m2o_owner          |                               |
      |   item:                            |                               |
      |     id: own-x                      |                               |
      |     name: lost                     |                               |
      | method: GET                        | code: 200                     |+
      | path: /items/test_nested_m2o_owner | body:                         |
      | query:                             |   data: []                    |
      |   filter[id][_eq]: own-x           |                               |
    Then response 1 is refused with the message:
      """
      Invalid payload. "test_nested_a2o_link.item" can't be linked to collection
      "test_nested_m2o_owner".
      """

  Scenario: a nested A2O object creates its row in the collection it names
    When these requests get these responses:
      | request                                | response                       |
      | method: POST                           | code: 200                      |+
      | path: /items/test_nested_a2o_link      | body:                          |
      | query:                                 |   data:                        |
      |   fields:                              |     item: po-n                 |
      |     - item                             |     target_collection: >-      |
      |     - target_collection                |       test_nested_a2o_post     |
      | payload:                               |                                |
      |   id: lk-n                             |                                |
      |   target_collection: >-                |                                |
      |     test_nested_a2o_post               |                                |
      |   item:                                |                                |
      |     id: po-n                           |                                |
      |     title: fresh                       |                                |
      | method: GET                            | code: 200                      |+
      | path: /items/test_nested_a2o_post/po-n | body:                          |
      |                                        |   data:                        |
      |                                        |     id: po-n                   |
      |                                        |     title: fresh               |
      | method: GET                            | code: 200                      |+
      | path: /revisions                       | body:                          |
      | query:                                 |   data:                        |
      |   filter[item][_eq]: lk-n              |     - data:                    |
      |   filter[collection][_eq]: >-          |         id: lk-n               |
      |     test_nested_a2o_link               |         target_collection: >-  |
      |   fields:                              |           test_nested_a2o_post |
      |     - data                             |         item: po-n             |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_activity    | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions   | 0      | 2      | 1      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 1       | test_nested_a2o_link | 1      | 1      | 0      | 0      |
      | 1       | test_nested_a2o_post | 1      | 1      | 0      | 0      |

  Scenario: a nested A2O object naming an existing row with fields updates it
    When these requests get these responses:
      | request                                | response         |
      | method: POST                           | code: 200        |+
      | path: /items/test_nested_a2o_page      |                  |
      | payload:                               |                  |
      |   id: pg-u                             |                  |
      |   title: before                        |                  |
      | method: POST                           | code: 200        |+
      | path: /items/test_nested_a2o_link      | body:            |
      | query:                                 |   data:          |
      |   fields:                              |     item: pg-u   |
      |     - item                             |                  |
      | payload:                               |                  |
      |   id: lk-u                             |                  |
      |   target_collection: >-                |                  |
      |     test_nested_a2o_page               |                  |
      |   item:                                |                  |
      |     id: pg-u                           |                  |
      |     title: after                       |                  |
      | method: GET                            | code: 200        |+
      | path: /items/test_nested_a2o_page/pg-u | body:            |
      |                                        |   data:          |
      |                                        |     id: pg-u     |
      |                                        |     title: after |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 2       | directus_activity    | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions   | 0      | 2      | 1      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | test_nested_a2o_link | 1      | 1      | 0      | 0      |
      | 2       | test_nested_a2o_page | 3      | 0      | 1      | 0      |

  Scenario: a nested A2O object naming an existing row alone leaves it unwritten
    When these requests get these responses:
      | request                           | response               |
      | method: POST                      | code: 200              |+
      | path: /items/test_nested_a2o_page |                        |
      | payload:                          |                        |
      |   id: pg-k                        |                        |
      |   title: kept                     |                        |
      | method: POST                      | code: 200              |+
      | path: /items/test_nested_a2o_link | body:                  |
      | query:                            |   data:                |
      |   fields:                         |     item: pg-k         |
      |     - item                        |                        |
      | payload:                          |                        |
      |   id: lk-k                        |                        |
      |   target_collection: >-           |                        |
      |     test_nested_a2o_page          |                        |
      |   item:                           |                        |
      |     id: pg-k                      |                        |
      | method: GET                       | code: 200              |+
      | path: /revisions                  | body:                  |
      | query:                            |   data:                |
      |   filter[item][_eq]: pg-k         |     - activity:        |
      |   fields:                         |         action: create |
      |     - activity.action             |       data:            |
      |     - data                        |         id: pg-k       |
      |                                   |         title: kept    |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 2       | directus_activity    | 0      | 1      | 0      | 0      |
      | 2       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | test_nested_a2o_link | 1      | 1      | 0      | 0      |
      | 2       | test_nested_a2o_page | 1      | 0      | 0      | 0      |

  Scenario: a PATCH carrying a nested A2O object needs its collection field too
    When these requests get these responses:
      | request                                | response                      |
      | method: POST                           | code: 200                     |+
      | path: /items/test_nested_a2o_link      |                               |
      | payload:                               |                               |
      |   id: lk-p                             |                               |
      | method: PATCH                          | code: 200                     |+
      | path: /items/test_nested_a2o_link/lk-p | body:                         |
      | query:                                 |   data:                       |
      |   fields:                              |     item: pg-p                |
      |     - item                             |                               |
      | payload:                               |                               |
      |   target_collection: >-                |                               |
      |     test_nested_a2o_page               |                               |
      |   item:                                |                               |
      |     id: pg-p                           |                               |
      |     title: patched                     |                               |
      | method: PATCH                          | code: 400                     |+
      | path: /items/test_nested_a2o_link/lk-p | body:                         |
      | payload:                               |   errors:                     |
      |   item:                                |     - extensions:             |
      |     id: pg-p                           |         code: INVALID_PAYLOAD |
      |     title: again                       |                               |
      | method: GET                            | code: 200                     |+
      | path: /items/test_nested_a2o_page/pg-p | body:                         |
      |                                        |   data:                       |
      |                                        |     id: pg-p                  |
      |                                        |     title: patched            |
    Then response 3 is refused with the message:
      """
      Invalid payload. Can't update nested record "test_nested_a2o_link.item"
      without field "test_nested_a2o_link.target_collection" being set.
      """
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 2       | directus_activity    | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions   | 0      | 2      | 1      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | test_nested_a2o_link | 3      | 0      | 1      | 0      |
      | 2       | test_nested_a2o_page | 1      | 1      | 0      | 0      |

  Scenario: a batch keyed by uuid reads back the rows it created
    When these requests get these responses:
      | request                            | response            |
      | method: POST                       | code: 200           |+
      | path: /items/test_batch_uuid_badge | body:               |
      | query:                             |   data:             |
      |   fields:                          |     - label: first  |
      |     - label                        |     - label: second |
      |   sort: label                      |                     |
      | payload:                           |                     |
      |   - label: first                   |                     |
      |   - label: second                  |                     |
