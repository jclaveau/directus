Feature: A delete purges by key the rows its ON DELETE rules change

  - The database applies a foreign key's ON DELETE rule without the items
    service: the delete reads the rows each rule will change before it runs,
    and purges them by key once it is committed. CASCADE removes the rows and
    walks on below them; SET NULL and SET DEFAULT rewrite them and stop.
    RESTRICT refuses the delete, so nothing is purged.
  - Past `CACHE_SCOPED_MAX_ON_DELETE_ROWS` rows, here 2, the rows are not
    named and every collection a rule reaches is purged whole.
  - The feature runs against an instance of its own with the response cache
    on, in Redis, and `CACHE_AUTO_PURGE` scoped: a write names the pins it
    purged in `x-scoped-cache-purged-tags`, and a cached read tells a flush by
    its `x-cache-status`. Every collection is sliced by `owner`.
  - The collections, each with its foreign key and rule:
    - on_delete_comment.task → on_delete_task, CASCADE
    - on_delete_reaction.comment → on_delete_comment, CASCADE
    - on_delete_node.parent → on_delete_node, CASCADE
    - on_delete_link.task → on_delete_task, SET NULL
    - on_delete_pin.task → on_delete_task, SET DEFAULT, the default null
    - on_delete_lock.task → on_delete_task, RESTRICT
  - A Given states the database rows and the cached reads a scenario starts
    from; the rows are written straight into the database. `<run>` stands for
    a value unique to the scenario, and any other `<name>` for a uuid of its
    own. A header stated as a list matches its comma-separated values in any
    order; one stated as `null` is one the response does not send.

  Scenario: a cascade purges the rows it removes level by level, by key
    Given the rows of on_delete_task:
      | id          | owner      |
      | <task>      | a-<run>    |
      | <kept-task> | kept-<run> |
    And the rows of on_delete_comment:
      | id             | owner      | task        |
      | <comment>      | a-<run>    | <task>      |
      | <kept-comment> | kept-<run> | <kept-task> |
    And the rows of on_delete_reaction:
      | id         | owner   | comment   |
      | <reaction> | a-<run> | <comment> |
    And this read is cached:
      | request                          | response              |
      | method: GET                      | code: 200             |+
      | path: /items/on_delete_comment   | headers:              |
      | query:                           |   x-cache-status: HIT |
      |   fields: id,owner               |                       |
      |   filter[owner][_eq]: kept-<run> |                       |
    Then these requests get these responses:
      | request                            | response                               |
      | method: DELETE                     | code: 204                              |+
      | path: /items/on_delete_task/<task> | headers:                               |
      |                                    |   x-scoped-cache-purged-tags:          |
      |                                    |     - on_delete_task                   |
      |                                    |     - on_delete_task:id=<task>         |
      |                                    |     - on_delete_task:owner=a-<run>     |
      |                                    |     - on_delete_comment                |
      |                                    |     - on_delete_comment:id=<comment>   |
      |                                    |     - on_delete_comment:owner=a-<run>  |
      |                                    |     - on_delete_reaction               |
      |                                    |     - on_delete_reaction:id=<reaction> |
      |                                    |     - on_delete_reaction:owner=a-<run> |
      | method: GET                        | code: 200                              |+
      | path: /items/on_delete_comment     | headers:                               |
      | query:                             |   x-cache-status: HIT                  |
      |   fields: id,owner                 |                                        |
      |   filter[owner][_eq]: kept-<run>   |                                        |

  Scenario: a cascade into its own collection purges each row it removes
    Given the rows of on_delete_node:
      | id          | owner      |
      | <root>      | a-<run>    |
      | <kept-node> | kept-<run> |
    And the rows of on_delete_node:
      | id       | owner   | parent |
      | <branch> | b-<run> | <root> |
    And the rows of on_delete_node:
      | id     | owner   | parent   |
      | <leaf> | c-<run> | <branch> |
    And this read is cached:
      | request                          | response              |
      | method: GET                      | code: 200             |+
      | path: /items/on_delete_node      | headers:              |
      | query:                           |   x-cache-status: HIT |
      |   fields: id,owner               |                       |
      |   filter[owner][_eq]: kept-<run> |                       |
    Then these requests get these responses:
      | request                            | response                           |
      | method: DELETE                     | code: 204                          |+
      | path: /items/on_delete_node/<root> | headers:                           |
      |                                    |   x-scoped-cache-purged-tags:      |
      |                                    |     - on_delete_node               |
      |                                    |     - on_delete_node:id=<root>     |
      |                                    |     - on_delete_node:owner=a-<run> |
      |                                    |     - on_delete_node:id=<branch>   |
      |                                    |     - on_delete_node:owner=b-<run> |
      |                                    |     - on_delete_node:id=<leaf>     |
      |                                    |     - on_delete_node:owner=c-<run> |
      | method: GET                        | code: 200                          |+
      | path: /items/on_delete_node        | headers:                           |
      | query:                             |   x-cache-status: HIT              |
      |   fields: id,owner                 |                                    |
      |   filter[owner][_eq]: kept-<run>   |                                    |

  Scenario: SET NULL purges the rows it rewrites, by key
    Given the rows of on_delete_task:
      | id     | owner   |
      | <task> | a-<run> |
    And the rows of on_delete_link:
      | id     | owner   | task   |
      | <link> | a-<run> | <task> |
    And this read is cached:
      | request                       | response              |
      | method: GET                   | code: 200             |+
      | path: /items/on_delete_link   | headers:              |
      | query:                        |   x-cache-status: HIT |
      |   fields: id,task             |                       |
      |   filter[owner][_eq]: a-<run> |                       |
    Then these requests get these responses:
      | request                            | response                           |
      | method: DELETE                     | code: 204                          |+
      | path: /items/on_delete_task/<task> | headers:                           |
      |                                    |   x-scoped-cache-purged-tags:      |
      |                                    |     - on_delete_task               |
      |                                    |     - on_delete_task:id=<task>     |
      |                                    |     - on_delete_task:owner=a-<run> |
      |                                    |     - on_delete_link               |
      |                                    |     - on_delete_link:id=<link>     |
      |                                    |     - on_delete_link:owner=a-<run> |
      | method: GET                        | code: 200                          |+
      | path: /items/on_delete_link        | headers:                           |
      | query:                             |   x-cache-status: MISS             |
      |   fields: id,task                  | body:                              |
      |   filter[owner][_eq]: a-<run>      |   data:                            |
      |                                    |     - id: <link>                   |
      |                                    |       task: null                   |

  Scenario: SET DEFAULT purges the rows it rewrites, by key
    Given the rows of on_delete_task:
      | id     | owner   |
      | <task> | a-<run> |
    And the rows of on_delete_pin:
      | id    | owner   | task   |
      | <pin> | a-<run> | <task> |
    And this read is cached:
      | request                       | response              |
      | method: GET                   | code: 200             |+
      | path: /items/on_delete_pin    | headers:              |
      | query:                        |   x-cache-status: HIT |
      |   fields: id,task             |                       |
      |   filter[owner][_eq]: a-<run> |                       |
    Then these requests get these responses:
      | request                            | response                           |
      | method: DELETE                     | code: 204                          |+
      | path: /items/on_delete_task/<task> | headers:                           |
      |                                    |   x-scoped-cache-purged-tags:      |
      |                                    |     - on_delete_task               |
      |                                    |     - on_delete_task:id=<task>     |
      |                                    |     - on_delete_task:owner=a-<run> |
      |                                    |     - on_delete_pin                |
      |                                    |     - on_delete_pin:id=<pin>       |
      |                                    |     - on_delete_pin:owner=a-<run>  |
      | method: GET                        | code: 200                          |+
      | path: /items/on_delete_pin         | headers:                           |
      | query:                             |   x-cache-status: MISS             |
      |   fields: id,task                  | body:                              |
      |   filter[owner][_eq]: a-<run>      |   data:                            |
      |                                    |     - id: <pin>                    |
      |                                    |       task: null                   |

  Scenario: a delete RESTRICT refuses purges nothing, the read stays cached
    Given the rows of on_delete_task:
      | id     | owner   |
      | <task> | a-<run> |
    And the rows of on_delete_lock:
      | id     | owner   | task   |
      | <lock> | a-<run> | <task> |
    And this read is cached:
      | request                       | response              |
      | method: GET                   | code: 200             |+
      | path: /items/on_delete_lock   | headers:              |
      | query:                        |   x-cache-status: HIT |
      |   fields: id,task             |                       |
      |   filter[owner][_eq]: a-<run> |                       |
    Then these requests get these responses:
      | request                            | response                           |
      | method: DELETE                     | code: 400                          |+
      | path: /items/on_delete_task/<task> | headers:                           |
      |                                    |   x-scoped-cache-purged-tags: null |
      |                                    | body:                              |
      |                                    |   errors:                          |
      |                                    |     - extensions:                  |
      |                                    |         code: INVALID_FOREIGN_KEY  |
      |                                    |         reason: still_referenced   |
      |                                    |         stack: diag                |
      | method: GET                        | code: 200                          |+
      | path: /items/on_delete_lock        | headers:                           |
      | query:                             |   x-cache-status: HIT              |
      |   fields: id,task                  | body:                              |
      |   filter[owner][_eq]: a-<run>      |   data:                            |
      |                                    |     - id: <lock>                   |
      |                                    |       task: <task>                 |

  Scenario: past the row cap, every collection a rule reaches is purged whole
    Given the rows of on_delete_task:
      | id          | owner      |
      | <task>      | a-<run>    |
      | <kept-task> | kept-<run> |
    And the rows of on_delete_comment:
      | id             | owner      | task        |
      | <first>        | a-<run>    | <task>      |
      | <second>       | a-<run>    | <task>      |
      | <third>        | a-<run>    | <task>      |
      | <kept-comment> | kept-<run> | <kept-task> |
    And this read is cached:
      | request                          | response              |
      | method: GET                      | code: 200             |+
      | path: /items/on_delete_comment   | headers:              |
      | query:                           |   x-cache-status: HIT |
      |   fields: id,owner               |                       |
      |   filter[owner][_eq]: kept-<run> |                       |
    Then these requests get these responses:
      | request                            | response                           |
      | method: DELETE                     | code: 204                          |+
      | path: /items/on_delete_task/<task> | headers:                           |
      |                                    |   x-scoped-cache-purged-tags:      |
      |                                    |     - on_delete_task               |
      |                                    |     - on_delete_task:id=<task>     |
      |                                    |     - on_delete_task:owner=a-<run> |
      |                                    |     - on_delete_comment            |
      |                                    |     - on_delete_reaction           |
      |                                    |     - on_delete_link               |
      |                                    |     - on_delete_pin                |
      | method: GET                        | code: 200                          |+
      | path: /items/on_delete_comment     | headers:                           |
      | query:                             |   x-cache-status: MISS             |
      |   fields: id,owner                 |                                    |
      |   filter[owner][_eq]: kept-<run>   |                                    |
