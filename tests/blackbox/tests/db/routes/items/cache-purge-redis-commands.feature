Feature: A write sends Redis the commands of the sets its rows reach

  Each scenario counts the Redis commands one write sends, from the request to
  its answer, its purge included: per command and key, the calls, and the keys
  or members a command carries when it carries several. A command spelled in
  capitals ran in a script. A cache entry's key is spelled `_response:<entry>`.

  `purge_command_row` is scoped by `owner`, its index path, then `team`. A write
  reads the bare set, the set of each owner its rows carry, and the home pin set
  of each team they carry. What else the collection holds cached is in sets the
  write never names, so it adds no command.

  Background:
    Given the cache is cleared

  Scenario: a row write reads the bare set and the sets of its own values
    Given these rows of purge_command_row:
      | markers | id | owner | team | revision |
      | row_1   | 1  | alpha | red  | 0        |
      | row_2   | 2  | beta  | blue | 0        |
    And these reads are cached:
      | markers  | query          |
      | owner_1  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: alpha |
      | team_1   | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   team:        |
      |          |     _eq: red   |
      | bare_1   | fields:        |+
      |          | - id           |
      |          | - revision     |
    When these rows are updated:
      | ids | values          |
      | [1] | {"revision": 1} |
    Then the write sent these Redis commands:
      | command    | key                                         | calls | items |
      | EXPIRE     | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | INCR       | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | SET        | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | UNLINK     | _response:<entry>                           | 1     | 3     |+
      | UNLINK     | _response:<entry>__expires_at               | 1     | 3     |+
      | evalsha    | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | mget       | scoped-cache-collection-index-keys-complete | 1     | 2     |+
      | mget       | scoped-cache-epoch:purge_command_row        | 2     | 4     |+
      | publish    | bus:websocket.event                         | 3     |       |+
      | smismember | scoped-cache-index:                         | 1     | 3     |+
      |            | collection-index-keys:                      |       |       |
      |            | purge_command_row                           |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:                          |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:owner=alpha               |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:pin:team=red              |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:                          |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:owner=alpha               |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:pin:team=red              |       |       |
    And these reads answer:
      | markers | query          | cache |
      | owner_1 | fields:        | MISS  |+
      |         | - id           |       |
      |         | - revision     |       |
      |         | filter:        |       |
      |         |   owner:       |       |
      |         |     _eq: alpha |       |
      | team_1  | fields:        | MISS  |+
      |         | - id           |       |
      |         | - revision     |       |
      |         | filter:        |       |
      |         |   team:        |       |
      |         |     _eq: red   |       |
      | bare_1  | fields:        | MISS  |+
      |         | - id           |       |
      |         | - revision     |       |

  Scenario: a row write sends the same commands whatever other values are cached
    Given these rows of purge_command_row:
      | markers | id | owner | team | revision |
      | row_3   | 3  | alpha | red  | 0        |
      | row_4   | 4  | beta  | blue | 0        |
    And these reads are cached:
      | markers  | query          |
      | owner_3  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: alpha |
      | team_3   | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   team:        |
      |          |     _eq: red   |
      | bare_3   | fields:        |+
      |          | - id           |
      |          | - revision     |
      | owner_4  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: beta  |
      | owner_5  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: gamma |
      | team_4   | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   team:        |
      |          |     _eq: blue  |
      | team_5   | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   team:        |
      |          |     _eq: green |
    When these rows are updated:
      | ids | values          |
      | [3] | {"revision": 1} |
    Then the write sent these Redis commands:
      | command    | key                                         | calls | items |
      | EXPIRE     | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | INCR       | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | SET        | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | UNLINK     | _response:<entry>                           | 1     | 3     |+
      | UNLINK     | _response:<entry>__expires_at               | 1     | 3     |+
      | evalsha    | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | mget       | scoped-cache-collection-index-keys-complete | 1     | 2     |+
      | mget       | scoped-cache-epoch:purge_command_row        | 2     | 4     |+
      | publish    | bus:websocket.event                         | 3     |       |+
      | smismember | scoped-cache-index:                         | 1     | 3     |+
      |            | collection-index-keys:                      |       |       |
      |            | purge_command_row                           |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:                          |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:owner=alpha               |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:pin:team=red              |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:                          |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:owner=alpha               |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:pin:team=red              |       |       |
    And these reads answer:
      | markers | query          | cache |
      | owner_4 | fields:        | HIT   |+
      |         | - id           |       |
      |         | - revision     |       |
      |         | filter:        |       |
      |         |   owner:       |       |
      |         |     _eq: beta  |       |
      | team_4  | fields:        | HIT   |+
      |         | - id           |       |
      |         | - revision     |       |
      |         | filter:        |       |
      |         |   team:        |       |
      |         |     _eq: blue  |       |

  Scenario: rows written in one request read each set they reach once
    Given these rows of purge_command_row:
      | markers | id | owner | team | revision |
      | row_5   | 5  | alpha | red  | 0        |
      | row_6   | 6  | alpha | red  | 0        |
      | row_7   | 7  | alpha | red  | 0        |
    And these reads are cached:
      | markers  | query          |
      | owner_6  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: alpha |
      | bare_6   | fields:        |+
      |          | - id           |
      |          | - revision     |
    When these rows are updated:
      | ids       | values          |
      | [5, 6, 7] | {"revision": 1} |
    Then the write sent these Redis commands:
      | command    | key                                         | calls | items |
      | EXPIRE     | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | INCR       | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | SET        | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | UNLINK     | _response:<entry>                           | 1     | 2     |+
      | UNLINK     | _response:<entry>__expires_at               | 1     | 2     |+
      | evalsha    | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | mget       | scoped-cache-collection-index-keys-complete | 1     | 2     |+
      | mget       | scoped-cache-epoch:purge_command_row        | 2     | 4     |+
      | publish    | bus:websocket.event                         | 7     |       |+
      | smismember | scoped-cache-index:                         | 1     | 5     |+
      |            | collection-index-keys:                      |       |       |
      |            | purge_command_row                           |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:                          |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:owner=alpha               |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:                          |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:owner=alpha               |       |       |

  Scenario: a row moved to another owner reads the sets of both owners
    Given these rows of purge_command_row:
      | markers | id | owner | team | revision |
      | row_8   | 8  | alpha | red  | 0        |
    And these reads are cached:
      | markers  | query          |
      | owner_8  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: alpha |
      | owner_9  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: beta  |
    When these rows are updated:
      | ids | values           |
      | [8] | {"owner": "beta"} |
    Then the write sent these Redis commands:
      | command    | key                                         | calls | items |
      | EXPIRE     | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | INCR       | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | SET        | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | UNLINK     | _response:<entry>                           | 1     | 2     |+
      | UNLINK     | _response:<entry>__expires_at               | 1     | 2     |+
      | evalsha    | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | mget       | scoped-cache-collection-index-keys-complete | 1     | 2     |+
      | mget       | scoped-cache-epoch:purge_command_row        | 2     | 4     |+
      | publish    | bus:websocket.event                         | 3     |       |+
      | smismember | scoped-cache-index:                         | 1     | 4     |+
      |            | collection-index-keys:                      |       |       |
      |            | purge_command_row                           |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:owner=alpha               |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:owner=beta                |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:                          |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:owner=alpha               |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:owner=beta                |       |       |

  Scenario: a row write sends the same commands after another deployment clears its caches
    Given these rows of purge_command_row:
      | markers | id | owner | team | revision |
      | row_10  | 10 | alpha | red  | 0        |
      | row_11  | 11 | beta  | blue | 0        |
    And these reads are cached:
      | markers  | query          |
      | owner_10 | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   owner:       |
      |          |     _eq: alpha |
      | team_10  | fields:        |+
      |          | - id           |
      |          | - revision     |
      |          | filter:        |
      |          |   team:        |
      |          |     _eq: red   |
      | bare_10  | fields:        |+
      |          | - id           |
      |          | - revision     |
    And another deployment on this Redis clears its system cache
    When these rows are updated:
      | ids  | values          |
      | [10] | {"revision": 1} |
    Then the write sent these Redis commands:
      | command    | key                                         | calls | items |
      | EXPIRE     | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | INCR       | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | SET        | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | UNLINK     | _response:<entry>                           | 1     | 3     |+
      | UNLINK     | _response:<entry>__expires_at               | 1     | 3     |+
      | evalsha    | scoped-cache-epoch:purge_command_row        | 1     |       |+
      | mget       | scoped-cache-collection-index-keys-complete | 1     | 2     |+
      | mget       | scoped-cache-epoch:purge_command_row        | 2     | 4     |+
      | publish    | bus:websocket.event                         | 3     |       |+
      | smismember | scoped-cache-index:                         | 1     | 3     |+
      |            | collection-index-keys:                      |       |       |
      |            | purge_command_row                           |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:                          |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:owner=alpha               |       |       |
      | srem       | scoped-cache-index:fingerprint:             | 1     | 2     |+
      |            | purge_command_row:pin:team=red              |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:                          |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:owner=alpha               |       |       |
      | sscan      | scoped-cache-index:fingerprint:             | 1     |       |+
      |            | purge_command_row:pin:team=red              |       |       |
