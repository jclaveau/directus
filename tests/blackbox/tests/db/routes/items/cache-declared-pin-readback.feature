Feature: A pin declared on an account key purges the reads of the owner it reaches

  `readback_entry` is scoped by "account.owner", so its cached reads are filed
  by owner. A hook that declares `purgeBy({ account: [k] })` names the account,
  not the owner: the purge reads account k back, finds its owner, and reads only
  that owner's index set. A read of another owner is left cached.

  Creating a `readback_signal` row rewrites entries by knex, behind the items
  service, or deletes an account with its entries, then declares the pins of its
  `declared` cell as `{ collection: readback_entry, pinnedScope }`. The
  declaration is the only thing that purges the entries' reads, so a read still
  answering the old rows after the signal is a declaration that missed it.

  An account that cannot be read back, deleted here, leaves the owner its
  entries were filed under unknown: the purge reads every set, and a read of
  another owner is purged too.

  Scenario: a pin on one account purges its owner's reads and spares another's
    Given these rows of readback_account:
      | markers   | id | owner  |
      | target_1  | 1  | target |
      | witness_1 | 2  | other  |
    And these rows of readback_entry:
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
    When a signal rewrites the entries and declares:
      | rewritten_ids | rewritten_values | declared           |
      | [1, 2]        | {"revision": 1}  | [{"account": [1]}] |
    Then target_1 is purged, as account 1 reaches its owner:
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
    And witness_1 is still cached, as account 1 does not reach its owner:
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

  Scenario: pins on the account a row left and the one it joined purge both owners
    Given these rows of readback_account:
      | markers   | id | owner       |
      | moved_2   | 3  | source      |
      | moved_2   | 4  | destination |
      | witness_2 | 5  | bystander   |
    And these rows of readback_entry:
      | markers   | id | account | revision |
      | moved_2   | 4  | 3       | 0        |
      | moved_2   | 5  | 3       | 0        |
      | moved_2   | 6  | 4       | 0        |
      | witness_2 | 7  | 5       | 0        |
    And these reads are cached:
      | markers   | query                  | response     |
      | moved_2   | fields:                | - id: 4      |+
      |           | - id                   |   account: 3 |
      |           | - account              | - id: 5      |
      |           | filter:                |   account: 3 |
      |           |   account:             |              |
      |           |     owner:             |              |
      |           |       _eq: source      |              |
      |           | sort:                  |              |
      |           | - id                   |              |
      | moved_2   | fields:                | - id: 6      |+
      |           | - id                   |   account: 4 |
      |           | - account              |              |
      |           | filter:                |              |
      |           |   account:             |              |
      |           |     owner:             |              |
      |           |       _eq: destination |              |
      |           | sort:                  |              |
      |           | - id                   |              |
      | witness_2 | fields:                | - id: 7      |+
      |           | - id                   |   account: 5 |
      |           | - account              |              |
      |           | filter:                |              |
      |           |   account:             |              |
      |           |     owner:             |              |
      |           |       _eq: bystander   |              |
      |           | sort:                  |              |
      |           | - id                   |              |
    When a signal moves entry 4 to account 4 and declares both accounts:
      | rewritten_ids | rewritten_values | declared                             |
      | [4]           | {"account": 4}   | [{"account": [3]}, {"account": [4]}] |
    Then both moved_2 reads are purged, as each account reaches one owner:
      | markers | query                  | response     |
      | moved_2 | fields:                | - id: 5      |+
      |         | - id                   |   account: 3 |
      |         | - account              |              |
      |         | filter:                |              |
      |         |   account:             |              |
      |         |     owner:             |              |
      |         |       _eq: source      |              |
      |         | sort:                  |              |
      |         | - id                   |              |
      | moved_2 | fields:                | - id: 4      |+
      |         | - id                   |   account: 4 |
      |         | - account              | - id: 6      |
      |         | filter:                |   account: 4 |
      |         |   account:             |              |
      |         |     owner:             |              |
      |         |       _eq: destination |              |
      |         | sort:                  |              |
      |         | - id                   |              |
    And witness_2 is still cached, as neither account reaches its owner:
      | markers   | query                | response     |
      | witness_2 | fields:              | - id: 7      |+
      |           | - id                 |   account: 5 |
      |           | - account            |              |
      |           | filter:              |              |
      |           |   account:           |              |
      |           |     owner:           |              |
      |           |       _eq: bystander |              |
      |           | sort:                |              |
      |           | - id                 |              |

  Scenario: a pin on a deleted account purges every owner's reads
    Given these rows of readback_account:
      | markers   | id | owner    |
      | target_3  | 6  | gone     |
      | witness_3 | 7  | survivor |
    And these rows of readback_entry:
      | markers   | id | account | revision |
      | target_3  | 8  | 6       | 0        |
      | witness_3 | 9  | 7       | 0        |
    And these reads are cached:
      | markers   | query               | response      |
      | target_3  | fields:             | - id: 8       |+
      |           | - id                |   revision: 0 |
      |           | - revision          |               |
      |           | filter:             |               |
      |           |   account:          |               |
      |           |     owner:          |               |
      |           |       _eq: gone     |               |
      |           | sort:               |               |
      |           | - id                |               |
      | witness_3 | fields:             | - id: 9       |+
      |           | - id                |   revision: 0 |
      |           | - revision          |               |
      |           | filter:             |               |
      |           |   account:          |               |
      |           |     owner:          |               |
      |           |       _eq: survivor |               |
      |           | sort:               |               |
      |           | - id                |               |
    When a signal deletes account 6 with its entries and declares it:
      | deleted_account | declared           |
      | 6               | [{"account": [6]}] |
    Then target_3 is purged, though account 6 is read back as no row:
      | markers  | query           | response |
      | target_3 | fields:         | []       |+
      |          | - id            |          |
      |          | - revision      |          |
      |          | filter:         |          |
      |          |   account:      |          |
      |          |     owner:      |          |
      |          |       _eq: gone |          |
      |          | sort:           |          |
      |          | - id            |          |
    And witness_3 is purged too, as the purge read every owner's set:
      | markers   | query               | response      |
      | witness_3 | fields:             | - id: 9       |+
      |           | - id                |   revision: 0 |
      |           | - revision          |               |
      |           | filter:             |               |
      |           |   account:          |               |
      |           |     owner:          |               |
      |           |       _eq: survivor |               |
      |           | sort:               |               |
      |           | - id                |               |
