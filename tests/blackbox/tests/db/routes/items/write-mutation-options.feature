Feature: ItemsService honours the write options no HTTP route sets

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list
    under `query` is sent joined by commas. A request authenticates as the
    admin.
  - A response cell states the `code` and the part of the `body` it checks.
  - `/write-options-probe/<route>` calls ItemsService on
    `test_write_option_row`, a string-keyed collection whose `user_created`
    records the user who created a row:
    `unawaited-create` creates without awaiting the action hooks,
    `refused-delete` deletes with a preMutationError, `group-update` calls
    updateGroups with no options, and `system-create` creates as the system,
    with no accountability.

  Scenario: a create that does not await its action hooks still writes the row
    When these requests get these responses:
      | request                                         | response            |
      | method: POST                                    | code: 200           |+
      | path: /write-options-probe/unawaited-create     | body:               |
      | payload:                                        |   key: wo-unawaited |
      |   key: wo-unawaited                             |                     |
      |   name: unawaited                               |                     |
      | method: GET                                     | code: 200           |+
      | path: /items/test_write_option_row/wo-unawaited | body:               |
      |                                                 |   data:             |
      |                                                 |     name: unawaited |

  Scenario: a delete refused by its preMutationError deletes nothing
    When these requests get these responses:
      | request                                       | response                        |
      | method: POST                                  | code: 200                       |+
      | path: /items/test_write_option_row            |                                 |
      | payload:                                      |                                 |
      |   id: wo-refused                              |                                 |
      |   name: kept                                  |                                 |
      | method: POST                                  | code: 200                       |+
      | path: /write-options-probe/refused-delete     | body:                           |
      | payload:                                      |   threw: true                   |
      |   key: wo-refused                             |   message: pre-mutation refusal |
      | method: GET                                   | code: 200                       |+
      | path: /items/test_write_option_row/wo-refused | body:                           |
      |                                               |   data:                         |
      |                                               |     name: kept                  |

  Scenario: updateGroups called with no options writes its group
    When these requests get these responses:
      | request                                     | response        |
      | method: POST                                | code: 200       |+
      | path: /items/test_write_option_row          |                 |
      | payload:                                    |                 |
      |   id: wo-group                              |                 |
      |   name: before                              |                 |
      | method: POST                                | code: 200       |+
      | path: /write-options-probe/group-update     | body:           |
      | payload:                                    |   keys:         |
      |   key: wo-group                             |     - wo-group  |
      |   name: after                               |                 |
      | method: GET                                 | code: 200       |+
      | path: /items/test_write_option_row/wo-group | body:           |
      |                                             |   data:         |
      |                                             |     name: after |

  Scenario: a row the system creates records no user, one the admin creates records it
    When these requests get these responses:
      | request                                  | response            |
      | method: POST                             | code: 200           |+
      | path: /write-options-probe/system-create | body:               |
      | payload:                                 |   key: wo-system    |
      |   key: wo-system                         |                     |
      |   name: by the system                    |                     |
      | method: POST                             | code: 200           |+
      | path: /items/test_write_option_row       |                     |
      | payload:                                 |                     |
      |   id: wo-admin                           |                     |
      |   name: by the admin                     |                     |
      | method: GET                              | code: 200           |+
      | path: /items/test_write_option_row       | body:               |
      | query:                                   |   data:             |
      |   filter[id][_in]:                       |     - id: wo-system |
      |     - wo-system                          |                     |
      |     - wo-admin                           |                     |
      |   filter[user_created][_null]: true      |                     |
      |   fields: id                             |                     |
