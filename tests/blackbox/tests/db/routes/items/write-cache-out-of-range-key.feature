Feature: A write whose hook takes over a key the database refuses purges whole

  - A request cell is YAML: `method`, `path`, `query` and `payload`, sent to
    the scoped-cache instance as the admin.
  - A response cell states the `code`, the `cache` status a read answered
    with, and the part of the `body` it checks.
  - Every `test_wca_*` collection scopes its cache on `slot`, keys on an
    integer and keeps no revisions.
  - `write-cache-failure-probe` runs an ItemsService write without
    accountability and answers its keys, or its failure's message.
  - On "take-over-out-of-range", the `write-cache-failure-hooks` hook takes
    over the key 99999999999 and declares slot "a" for it through `purgeBy`
    and `forKey`. Postgres refuses that key as an integer, so re-reading the
    slices of the rows written fails.

  Scenario: an update whose takeover cannot be re-read purges the collection whole
    When these requests get these responses:
      | request                                      | response              |
      | method: POST                                 | code: 200             |+
      | path: /items/test_wca_update                 |                       |
      | payload:                                     |                       |
      |   - id: 1                                    |                       |
      |     slot: a                                  |                       |
      |     body: original                           |                       |
      |   - id: 2                                    |                       |
      |     slot: c                                  |                       |
      |     body: bystander                          |                       |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_update                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_update                 | cache: HIT            |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_update                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_update                 | cache: HIT            |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |
      | method: POST                                 | code: 200             |+
      | path: /write-cache-failure-probe/update-many |                       |
      | payload:                                     |                       |
      |   collection: test_wca_update                |                       |
      |   keys: [1]                                  |                       |
      |   data:                                      |                       |
      |     body: take-over-out-of-range             |                       |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_update                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_update                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |

  Scenario: an upsert whose takeover cannot be re-read purges the collection whole
    When these requests get these responses:
      | request                                      | response              |
      | method: POST                                 | code: 200             |+
      | path: /items/test_wca_upsert                 |                       |
      | payload:                                     |                       |
      |   - id: 1                                    |                       |
      |     slot: a                                  |                       |
      |     body: original                           |                       |
      |   - id: 2                                    |                       |
      |     slot: c                                  |                       |
      |     body: bystander                          |                       |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_upsert                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_upsert                 | cache: HIT            |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_upsert                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_upsert                 | cache: HIT            |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |
      | method: POST                                 | code: 200             |+
      | path: /write-cache-failure-probe/upsert-many |                       |
      | payload:                                     |                       |
      |   collection: test_wca_upsert                |                       |
      |   payloads:                                  |                       |
      |     - body: take-over-out-of-range           |                       |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_upsert                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_upsert                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |

  Scenario: a create whose takeover cannot be re-read purges the collection whole
    When these requests get these responses:
      | request                                      | response              |
      | method: POST                                 | code: 200             |+
      | path: /items/test_wca_create                 |                       |
      | payload:                                     |                       |
      |   - id: 1                                    |                       |
      |     slot: a                                  |                       |
      |     body: original                           |                       |
      |   - id: 2                                    |                       |
      |     slot: c                                  |                       |
      |     body: bystander                          |                       |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_create                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_create                 | cache: HIT            |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_create                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_create                 | cache: HIT            |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |
      | method: POST                                 | code: 200             |+
      | path: /write-cache-failure-probe/create-many |                       |
      | payload:                                     |                       |
      |   collection: test_wca_create                |                       |
      |   payloads:                                  |                       |
      |     - body: take-over-out-of-range           |                       |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_create                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: a                       |     - body: original  |
      | method: GET                                  | code: 200             |+
      | path: /items/test_wca_create                 | cache: MISS           |
      | query:                                       | body:                 |
      |   fields: body                               |   data:               |
      |   filter[slot][_eq]: c                       |     - body: bystander |
