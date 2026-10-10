Feature: A create reaches its hooks as entries, then once per row

  - Every create reaches its hooks as one `items.create` event carrying one
    `{ data }` entry per row, then one `items.create.one` per row.
  - The rows live in `test_create_groups`, whose events the create-groups-probe
    hook writes into a log read back here. A logged event names a row when its
    payload holds the row's name.
  - The probe's grouped filter acts on a row's name:
    - "legacy-shape": answers with that row's payload alone.
    - "twin-of-first": answers `{ sameRowAs: 0 }`.
    - "cancel-in-group": answers `null` for that row.
    - "strip-name": deletes `name` off the list itself.
    - "check-name": reads `name` off the list itself, throwing when it reads
      "check-name".
    - "take-over": inserts that row itself and answers `{ key }` with its id.
  - A request authenticates as the admin.

  Scenario: a create fires the grouped event once, then the per-row one per row
    When these requests get these responses:
      | request                         | response          |
      | method: POST                    | code: 200         |+
      | path: /items/test_create_groups | body:             |
      | payload:                        |   data:           |
      |   - name: e-one                 |     - name: e-one |
      |   - name: e-two                 |     - name: e-two |
    Then the grouped filter naming "e-one" received:
      | entries         |
      | - data:         |+
      |     name: e-one |
      | - data:         |
      |     name: e-two |
    And the create events naming "e-one" or "e-two" are:
      | event            | phase  | count |
      | items.create     | filter | 1     |
      | items.create.one | filter | 2     |
      | items.create     | action | 1     |
      | items.create.one | action | 2     |

  Scenario: a grouped hook answering with one payload is refused
    When these requests get these responses:
      | request                                       | response                      |
      | method: POST                                  | code: 400                     |+
      | path: /items/test_create_groups               | body:                         |
      | payload:                                      |   errors:                     |
      |   - name: legacy-peer                         |     - extensions:             |
      |   - name: legacy-shape                        |         code: INVALID_PAYLOAD |
      | method: GET                                   | code: 200                     |+
      | path: /items/test_create_groups               | body:                         |
      | query:                                        |   data: []                    |
      |   filter[name][_in]: legacy-peer,legacy-shape |                               |
    Then the first refusal names "items.create.one"

  Scenario: a grouped hook deleting a field off the list is refused, creating nothing
    When these requests get these responses:
      | request                                    | response                      |
      | method: POST                               | code: 400                     |+
      | path: /items/test_create_groups            | body:                         |
      | payload:                                   |   errors:                     |
      |   - name: strip-peer                       |     - extensions:             |
      |   - name: strip-name                       |         code: INVALID_PAYLOAD |
      | method: GET                                | code: 200                     |+
      | path: /items/test_create_groups            | body:                         |
      | query:                                     |   data: []                    |
      |   filter[name][_in]: strip-peer,strip-name |                               |
    Then the first refusal names "items.create.one"

  Scenario: a grouped hook reading a field off the list is refused, creating nothing
    When these requests get these responses:
      | request                                    | response                      |
      | method: POST                               | code: 400                     |+
      | path: /items/test_create_groups            | body:                         |
      | payload:                                   |   errors:                     |
      |   - name: check-peer                       |     - extensions:             |
      |   - name: check-name                       |         code: INVALID_PAYLOAD |
      | method: GET                                | code: 200                     |+
      | path: /items/test_create_groups            | body:                         |
      | query:                                     |   data: []                    |
      |   filter[name][_in]: check-peer,check-name |                               |
    Then the first refusal names "items.create.one"

  Scenario: a grouped hook marking a twin inserts the row once
    When these requests get these responses:
      | request                                   | response           |
      | method: POST                              | code: 200          |+
      | path: /items/test_create_groups           |                    |
      | payload:                                  |                    |
      |   - name: twin-a                          |                    |
      |   - name: twin-of-first                   |                    |
      | method: GET                               | code: 200          |+
      | path: /items/test_create_groups           | body:              |
      | query:                                    |   data:            |
      |   fields: name                            |     - name: twin-a |
      |   filter[name][_in]: twin-a,twin-of-first |                    |
    Then the create events naming "twin-of-first" are:
      | event            | phase  | count |
      | items.create     | filter | 1     |
      | items.create.one | filter | 0     |
      | items.create.one | action | 0     |

  Scenario: a grouped hook cancelling one row writes its siblings
    When these requests get these responses:
      | request                                   | response         |
      | method: POST                              | code: 200        |+
      | path: /items/test_create_groups           | body:            |
      | query:                                    |   data:          |
      |   fields: name                            |     - name: kept |
      | payload:                                  |                  |
      |   - name: cancel-in-group                 |                  |
      |   - name: kept                            |                  |
      | method: GET                               | code: 200        |+
      | path: /items/test_create_groups           | body:            |
      | query:                                    |   data:          |
      |   fields: name                            |     - name: kept |
      |   filter[name][_in]: cancel-in-group,kept |                  |
    Then the create events naming "cancel-in-group" are:
      | event            | phase  | count |
      | items.create     | filter | 1     |
      | items.create.one | filter | 0     |
      | items.create.one | action | 0     |

  Scenario: a row a grouped hook takes over is left out of the grouped action
    When these requests get these responses:
      | request                                      | response                  |
      | method: POST                                 | code: 200                 |+
      | path: /items/test_create_groups              |                           |
      | payload:                                     |                           |
      |   - name: takeover-peer                      |                           |
      |   - name: take-over                          |                           |
      | method: GET                                  | code: 200                 |+
      | path: /items/test_create_groups              | body:                     |
      | query:                                       |   data:                   |
      |   fields: name                               |     - name: take-over     |
      |   sort: name                                 |     - name: takeover-peer |
      |   filter[name][_in]: take-over,takeover-peer |                           |
    Then the create events naming "take-over" are:
      | event            | phase  | count |
      | items.create     | filter | 1     |
      | items.create.one | filter | 0     |
      | items.create     | action | 0     |
      | items.create.one | action | 0     |
    And the grouped action naming "takeover-peer" carries that row alone
