Feature: purgeForMutatedRows on a relationally-scoped collection purges the rows' slices

  `rawpurge_entry` is scoped by "account.owner", a field of the account the entry
  points to. A raw row carries the "account" key, not the owner it resolves to, so
  the handle reads the rows back by their primary keys, joins the owner in, and
  purges the slices of the owners those rows sit in. A read of another owner's
  entries is left cached.

  The cache-raw-purge endpoint raw-writes the entries of one owner by knex,
  bypassing the items service, and hands `purgeForMutatedRows` their "id" and
  "account".

  The unreadable write adds the key "not-a-key": the deleted rows already cover a
  key the read back does not find, while postgres refuses this one in the read
  itself, so that scenario covers the read back throwing.

  Scenario: a raw write to one owner's entries purges that owner's reads only
    Given these rows of rawpurge_account:
      | markers   | id | owner  |
      | target_1  | 1  | target |
      | witness_1 | 2  | other  |
    And these rows of rawpurge_entry:
      | markers   | id | account | revision |
      | target_1  | 1  | 1       | 0        |
      | target_1  | 2  | 1       | 0        |
      | witness_1 | 3  | 2       | 0        |
    And these reads are cached:
      | markers   | query             | response      |
      | target_1  | fields:           | - id: 1       |+
      |           | - id              |   revision: 0 |
      |           | - revision        | - id: 2       |
      |           | filter:           |   revision: 0 |
      |           |   account:        |               |
      |           |     owner:        |               |
      |           |       _eq: target |               |
      |           | sort:             |               |
      |           | - id              |               |
      | witness_1 | fields:           | - id: 3       |+
      |           | - id              |   revision: 0 |
      |           | - revision        |               |
      |           | filter:           |               |
      |           |   account:        |               |
      |           |     owner:        |               |
      |           |       _eq: other  |               |
      |           | sort:             |               |
      |           | - id              |               |
    When the endpoint raw-writes the "target" entries and purges them, keys included:
      | owner  | entries |
      | target | 2       |
    Then target_1 is purged, as its entries sit in the owner the written rows resolve to:
      | markers  | query             | response      |
      | target_1 | fields:           | - id: 1       |+
      |          | - id              |   revision: 1 |
      |          | - revision        | - id: 2       |
      |          | filter:           |   revision: 1 |
      |          |   account:        |               |
      |          |     owner:        |               |
      |          |       _eq: target |               |
      |          | sort:             |               |
      |          | - id              |               |
    And witness_1 is still cached, as no written row resolves to its owner:
      | markers   | query            | response      |
      | witness_1 | fields:          | - id: 3       |+
      |           | - id             |   revision: 0 |
      |           | - revision       |               |
      |           | filter:          |               |
      |           |   account:       |               |
      |           |     owner:       |               |
      |           |       _eq: other |               |
      |           | sort:            |               |
      |           | - id             |               |

  Scenario: a raw delete of one owner's entries purges that owner's reads
    Given these rows of rawpurge_account:
      | markers  | id | owner          |
      | target_2 | 3  | deleted_target |
    And these rows of rawpurge_entry:
      | markers  | id | account | revision |
      | target_2 | 4  | 3       | 0        |
      | target_2 | 5  | 3       | 0        |
    And these reads are cached:
      | markers  | query                     | response      |
      | target_2 | fields:                   | - id: 4       |+
      |          | - id                      |   revision: 0 |
      |          | - revision                | - id: 5       |
      |          | filter:                   |   revision: 0 |
      |          |   account:                |               |
      |          |     owner:                |               |
      |          |       _eq: deleted_target |               |
      |          | sort:                     |               |
      |          | - id                      |               |
    When the endpoint raw-deletes the "deleted_target" entries and purges them:
      | owner          | entries |
      | deleted_target | 2       |
    Then target_2 is purged, though the read back finds none of the deleted rows:
      | markers  | query                     | response |
      | target_2 | fields:                   | []       |+
      |          | - id                      |          |
      |          | - revision                |          |
      |          | filter:                   |          |
      |          |   account:                |          |
      |          |     owner:                |          |
      |          |       _eq: deleted_target |          |
      |          | sort:                     |          |
      |          | - id                      |          |

  Scenario: a raw write whose keys cannot all be read back purges the collection
    Given these rows of rawpurge_account:
      | markers  | id | owner             |
      | target_3 | 4  | unreadable_target |
    And these rows of rawpurge_entry:
      | markers  | id | account | revision |
      | target_3 | 6  | 4       | 0        |
    And these reads are cached:
      | markers  | query                        | response      |
      | target_3 | fields:                      | - id: 6       |+
      |          | - id                         |   revision: 0 |
      |          | - revision                   |               |
      |          | filter:                      |               |
      |          |   account:                   |               |
      |          |     owner:                   |               |
      |          |       _eq: unreadable_target |               |
      |          | sort:                        |               |
      |          | - id                         |               |
    When the endpoint raw-writes the "unreadable_target" entries, adding a key no row holds:
      | owner             | entries |
      | unreadable_target | 1       |
    Then target_3 is purged, as the write could not be bound to its rows:
      | markers  | query                        | response      |
      | target_3 | fields:                      | - id: 6       |+
      |          | - id                         |   revision: 1 |
      |          | - revision                   |               |
      |          | filter:                      |               |
      |          |   account:                   |               |
      |          |     owner:                   |               |
      |          |       _eq: unreadable_target |               |
      |          | sort:                        |               |
      |          | - id                         |               |
