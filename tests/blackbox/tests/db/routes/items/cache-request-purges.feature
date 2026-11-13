Feature: An extension reads the purges its request reached

  `context.scopedCache.readRequestPurges()` answers the fingerprints every
  scoped-cache purge of the current request reached, in order. A purge queued on
  the commit of a transaction the request opened raw is waited for, so it is named
  too.

  reqpurge_lesson is scoped by "owner". The cache-request-purges endpoint sets
  "revision" to 1 on the rows of the keys it is sent, through the route it is sent
  to, then answers what `readRequestPurges` reads:
  - /update: one items-service update per key.
  - /update-in-transaction: the same, inside `database.transaction()`.
  - /raw-update: a knex update, its rows handed to `purgeForMutatedRows`.
  - /read-only: writes nothing.

  Scenario: an items-service update names the slices it purged
    Given these rows of reqpurge_lesson:
      | id | owner | revision |
      | 1  | alpha | 0        |
    When the endpoint writes and answers what the request purged:
      | request       | response                      |
      | route: update | purged:                       |+
      | keys: [1]     | - collection: reqpurge_lesson |
      |               | - collection: reqpurge_lesson |
      |               |   pinnedScope:                |
      |               |     id: ['1']                 |
      |               |     owner: [alpha]            |

  Scenario: two updates of one request are both named, in order
    Given these rows of reqpurge_lesson:
      | id | owner | revision |
      | 2  | alpha | 0        |
      | 3  | beta  | 0        |
    When the endpoint writes and answers what the request purged:
      | request       | response                      |
      | route: update | purged:                       |+
      | keys: [2, 3]  | - collection: reqpurge_lesson |
      |               | - collection: reqpurge_lesson |
      |               |   pinnedScope:                |
      |               |     id: ['2']                 |
      |               |     owner: [alpha]            |
      |               | - collection: reqpurge_lesson |
      |               | - collection: reqpurge_lesson |
      |               |   pinnedScope:                |
      |               |     id: ['3']                 |
      |               |     owner: [beta]             |

  Scenario: an update inside a raw transaction is named once it committed
    Given these rows of reqpurge_lesson:
      | id | owner | revision |
      | 4  | gamma | 0        |
    When the endpoint writes and answers what the request purged:
      | request                      | response                      |
      | route: update-in-transaction | purged:                       |+
      | keys: [4]                    | - collection: reqpurge_lesson |
      |                              | - collection: reqpurge_lesson |
      |                              |   pinnedScope:                |
      |                              |     id: ['4']                 |
      |                              |     owner: [gamma]            |

  Scenario: a raw write handed to purgeForMutatedRows is named
    Given these rows of reqpurge_lesson:
      | id | owner | revision |
      | 5  | delta | 0        |
    When the endpoint writes and answers what the request purged:
      | request           | response                      |
      | route: raw-update | purged:                       |+
      | keys: [5]         | - collection: reqpurge_lesson |
      |                   | - collection: reqpurge_lesson |
      |                   |   pinnedScope:                |
      |                   |     id: ['5']                 |
      |                   |     owner: [delta]            |

  Scenario: a request writing nothing reads an empty list
    When the endpoint writes and answers what the request purged:
      | request          | response   |
      | route: read-only | purged: [] |+
      | keys: []         |            |
