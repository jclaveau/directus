Feature: A read pinning the primary key is purged through its home pin set

  A read is filed in one index set per value of its home pin, the first field it
  pins among the collection's primary key then its scope fields. The key ranks
  first: its set holds the reads of one row, so a one-row write reads a set of
  that row's reads rather than a whole tenant's. A read filtered on "id: 3" is
  filed under "pin:id=3", one filtered on "id: {_in: [1, 2]}" under both
  "pin:id=1" and "pin:id=2".

  A write reads back the home pin sets of the values its rows carry, so a read
  pinning the key a written row carries is purged, and a read pinning another key
  is left cached, even when both rows share every scope value.

  `purgeForMutatedRows` is handed rows the cache-raw-purge endpoint raw-wrote,
  primary key included, so it reaches the same home pin sets a write through the
  items service does. The endpoint writes `rawpurge_document`, the collection
  `cache-raw-purge.test.ts` also creates; each file drops it when it ends.

  Scenario: purgeForMutatedRows with the rows' keys purges the read pinning that key
    Given these rows of rawpurge_document:
      | markers   | id | owner  | revision |
      | target_1  | 3  | target | 0        |
      | witness_1 | 4  | other  | 0        |
    And these reads are cached, each filed under the home pin sets of its keys:
      | markers   | query      | response       | home pin sets |
      | target_1  | fields:    | - id: 3        | - pin:id=3    |+
      |           | - id       |   revision: 0  |               |
      |           | - revision |                |               |
      |           | filter:    |                |               |
      |           |   id: 3    |                |               |
      | witness_1 | fields:    | - id: 4        | - pin:id=4    |+
      |           | - id       |   revision: 0  |               |
      |           | - revision |                |               |
      |           | filter:    |                |               |
      |           |   id: 4    |                |               |
    When the endpoint raw-writes the "target" rows and purges them, keys included:
      | owner  | documents | lines |
      | target | 1         | 0     |
    Then target_1 is purged, as it pins "id" to 3, the key the purged row carries:
      | markers  | query      | response       |
      | target_1 | fields:    | - id: 3        |+
      |          | - id       |   revision: 1  |
      |          | - revision |                |
      |          | filter:    |                |
      |          |   id: 3    |                |
    And witness_1 is still cached, as it pins "id" to 4, a key no purged row carries:
      | markers   | query      | response       |
      | witness_1 | fields:    | - id: 4        |+
      |           | - id       |   revision: 0  |
      |           | - revision |                |
      |           | filter:    |                |
      |           |   id: 4    |                |

  Scenario: a batch PATCH naming each row's key purges the read pinning that key
    Given these rows of home_pin_batch_patch:
      | markers   | id | owner | label |
      | target_1  | 1  | alpha | old   |
      | target_1  | 2  | alpha | old   |
      | witness_1 | 5  | alpha | old   |
    And these reads are cached, each filed under the home pin sets of its keys:
      | markers   | query     | response     | home pin sets |
      | target_1  | fields:   | - id: 1      | - pin:id=1    |+
      |           | - id      |   label: old | - pin:id=2    |
      |           | - label   | - id: 2      |               |
      |           | filter:   |   label: old |               |
      |           |   id:     |              |               |
      |           |     _in:  |              |               |
      |           |     - 1   |              |               |
      |           |     - 2   |              |               |
      |           | sort:     |              |               |
      |           | - id      |              |               |
      | witness_1 | fields:   | - id: 5      | - pin:id=5    |+
      |           | - id      |   label: old |               |
      |           | - label   |              |               |
      |           | filter:   |              |               |
      |           |   id: 5   |              |               |
    When the rows are written in one batch PATCH, each naming its key:
      | body         |
      | - id: 2      |+
      |   label: new |
    Then target_1 is purged, as it pins "id" to 2, the key the written row carries:
      | markers  | query     | response     |
      | target_1 | fields:   | - id: 1      |+
      |          | - id      |   label: old |
      |          | - label   | - id: 2      |
      |          | filter:   |   label: new |
      |          |   id:     |              |
      |          |     _in:  |              |
      |          |     - 1   |              |
      |          |     - 2   |              |
      |          | sort:     |              |
      |          | - id      |              |
    And witness_1 is still cached, as it pins "id" to 5, not the "owner" it shares:
      | markers   | query   | response     |
      | witness_1 | fields: | - id: 5      |+
      |           | - id    |   label: old |
      |           | - label |              |
      |           | filter: |              |
      |           |   id: 5 |              |
