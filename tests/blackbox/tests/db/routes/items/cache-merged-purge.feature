Feature: The purges a transaction queues for one collection run as one

  A hook writing per row on its parent's transaction queues one purge per row,
  run after COMMIT. Each purge scans the same index sets, so they are merged
  into one purge of every row they name: it scans once, and drops every entry
  the separate purges would have dropped.

  Creating a `merged_purge_signal` row updates the `merged_purge_row` rows of
  its `updated_ids` one by one, each with its `updated_values`, through an
  items service on the signal's transaction. Each purge moves the collection's
  purge counter, so a signal updating five rows moves it as much as a signal
  updating one, and sends Redis the same reads: one per index set the rows
  reach. A command spelled in capitals ran in a script.

  Scenario: five rows updated one by one purge their collection once
    Given these rows of merged_purge_row:
      | markers | id | owner | revision |
      | batch_1 | 1  | alpha | 0        |
      | batch_1 | 2  | alpha | 0        |
      | batch_1 | 3  | alpha | 0        |
      | batch_1 | 4  | alpha | 0        |
      | batch_1 | 5  | alpha | 0        |
    When a signal updates these rows one by one:
      | updated_ids | updated_values  |
      | [1]         | {"revision": 1} |
    And a signal updates these rows one by one:
      | updated_ids     | updated_values  |
      | [1, 2, 3, 4, 5] | {"revision": 2} |
    Then the second signal moved the rows' purge counter as much as the first

  Scenario: five rows updated one by one send Redis the commands of one purge
    Given these rows of merged_purge_row:
      | markers | id | owner | revision |
      | batch_3 | 9  | gamma | 0        |
      | batch_3 | 10 | gamma | 0        |
      | batch_3 | 11 | gamma | 0        |
      | batch_3 | 12 | gamma | 0        |
      | batch_3 | 13 | gamma | 0        |
    When a signal updates these rows one by one:
      | id  | updated_ids | updated_values  |
      | 901 | [9]         | {"revision": 1} |
    And a signal updates these rows one by one:
      | id  | updated_ids         | updated_values  |
      | 902 | [9, 10, 11, 12, 13] | {"revision": 2} |
    Then the first signal sent these Redis commands:
      | command | key                                         | calls | items |
      | EXPIRE  | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | EXPIRE  | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | INCR    | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | INCR    | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | SET     | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | SET     | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | evalsha | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | evalsha | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | mget    | scoped-cache-collection-index-keys-complete | 2     | 4     |+
      | mget    | scoped-cache-epoch:merged_purge_row         | 1     | 2     |+
      | mget    | scoped-cache-epoch:                         | 1     | 2     |+
      |         | merged_purge_signal                         |       |       |
      | publish | bus:websocket.event                         | 6     |       |+
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:owner=gamma                |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:id=9                   |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:owner=gamma            |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_signal:                        |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_signal:pin:id=901              |       |       |
    And the second signal sent these Redis commands:
      | command | key                                         | calls | items |
      | EXPIRE  | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | EXPIRE  | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | INCR    | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | INCR    | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | SET     | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | SET     | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | evalsha | scoped-cache-epoch:merged_purge_row         | 1     |       |+
      | evalsha | scoped-cache-epoch:                         | 1     |       |+
      |         | merged_purge_signal                         |       |       |
      | mget    | scoped-cache-collection-index-keys-complete | 2     | 4     |+
      | mget    | scoped-cache-epoch:merged_purge_row         | 1     | 2     |+
      | mget    | scoped-cache-epoch:                         | 1     | 2     |+
      |         | merged_purge_signal                         |       |       |
      | publish | bus:websocket.event                         | 14    |       |+
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:owner=gamma                |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:id=10                  |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:id=11                  |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:id=12                  |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:id=13                  |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:id=9                   |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_row:pin:owner=gamma            |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_signal:                        |       |       |
      | sscan   | scoped-cache-index:fingerprint:             | 1     |       |+
      |         | merged_purge_signal:pin:id=902              |       |       |

  Scenario: the merged purge drops the reads of every row it names and spares the others
    Given these rows of merged_purge_row:
      | markers   | id | owner   | revision |
      | north_2   | 6  | north   | 0        |
      | south_2   | 7  | south   | 0        |
      | witness_2 | 8  | witness | 0        |
    And these reads are cached:
      | markers   | query            | response      |
      | north_2   | fields:          | - id: 6       |+
      |           | - id             |   revision: 0 |
      |           | - revision       |               |
      |           | filter:          |               |
      |           |   owner:         |               |
      |           |     _eq: north   |               |
      | south_2   | fields:          | - id: 7       |+
      |           | - id             |   revision: 0 |
      |           | - revision       |               |
      |           | filter:          |               |
      |           |   owner:         |               |
      |           |     _eq: south   |               |
      | witness_2 | fields:          | - id: 8       |+
      |           | - id             |   revision: 0 |
      |           | - revision       |               |
      |           | filter:          |               |
      |           |   owner:         |               |
      |           |     _eq: witness |               |
    When a signal updates these rows one by one:
      | updated_ids | updated_values  |
      | [6, 7]      | {"revision": 1} |
    Then north_2 and south_2 are purged, as each names a row the signal updated:
      | markers | query          | response      |
      | north_2 | fields:        | - id: 6       |+
      |         | - id           |   revision: 1 |
      |         | - revision     |               |
      |         | filter:        |               |
      |         |   owner:       |               |
      |         |     _eq: north |               |
      | south_2 | fields:        | - id: 7       |+
      |         | - id           |   revision: 1 |
      |         | - revision     |               |
      |         | filter:        |               |
      |         |   owner:       |               |
      |         |     _eq: south |               |
    And witness_2 is still cached, as no row the signal updated reaches it:
      | markers   | query            | response      |
      | witness_2 | fields:          | - id: 8       |+
      |           | - id             |   revision: 0 |
      |           | - revision       |               |
      |           | filter:          |               |
      |           |   owner:         |               |
      |           |     _eq: witness |               |
