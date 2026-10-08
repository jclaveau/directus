Feature: An update reaches its hooks as groups, then once per row

  Every update reaches its hooks as groups: one `items.update` event carrying
  `{ data, keys }[]`, then one `items.update.one` per row. The rows live in
  `test_update_groups`, whose events the update-groups-probe hook writes into a
  log read back here. A row is named by the `name` it was created with; a
  blank cell in what a batch sends leaves that field out, so the row sends its
  key alone.

  The probe acts on these markers:
  - name "cancel-me": the per-row filter cancels the row.
  - name "rewrite-me": the per-row filter renames the row "rewritten".
  - status "legacy-shape": the grouped filter answers with that group's
    payload alone, the shape it had before the event carried groups.
  - status "drop-key": the grouped filter drops that group's first key.
  - status "strip-name": the grouped filter deletes `name` off the list itself.
  - status "check-status": the grouped filter reads `status` off the list
    itself, throwing when it reads "check-status".

  Scenario: an update fires the grouped event once, then the per-row one per row
    Given the rows:
      | name    |
      | a-one   |
      | a-two   |
      | a-three |
    When the rows are updated to the status "archived"
    Then the grouped filter carries:
      | status   | names                       |
      | archived | ["a-one","a-two","a-three"] |
    And the update events naming these rows are:
      | event            | phase  | count |
      | items.update     | filter | 1     |
      | items.update.one | filter | 3     |
      | items.update     | action | 1     |
      | items.update.one | action | 3     |

  Scenario: a batch where every row writes nothing answers with every row
    Given the rows:
      | name   |
      | noop-a |
      | noop-b |
    When the batch sends:
      | name   | status |
      | noop-a |        |
      | noop-b |        |
    Then the update answers:
      | name   | status |
      | noop-a |        |
      | noop-b |        |

  Scenario: a batch answers with every row it was sent, no-op rows included
    Given the rows:
      | name     |
      | noop-one |
      | noop-two |
    When the batch sends:
      | name     | status   |
      | noop-one |          |
      | noop-two | archived |
    Then the update answers:
      | name     | status   |
      | noop-one |          |
      | noop-two | archived |

  Scenario: rows carrying the same change are written together, however far apart
    Given the rows:
      | name    |
      | apart-a |
      | apart-b |
      | apart-c |
    When the batch sends:
      | name    | status   |
      | apart-a | archived |
      | apart-b | kept     |
      | apart-c | archived |
    Then the grouped action carries:
      | status   | names                 |
      | archived | ["apart-a","apart-c"] |
      | kept     | ["apart-b"]           |
    And the update events naming these rows are:
      | event            | phase  | count |
      | items.update     | filter | 1     |
      | items.update.one | filter | 3     |
      | items.update     | action | 1     |
      | items.update.one | action | 3     |

  Scenario: a grouped hook answering with one payload is refused, naming the per-row event
    Given the rows:
      | name   |
      | legacy |
    When the rows are updated to the status "legacy-shape"
    Then the update is refused with a reason naming "items.update.one"
    And the rows hold:
      | name   | status |
      | legacy |        |

  Scenario: a grouped hook dropping a key is refused, naming the per-row event
    Given the rows:
      | name   |
      | drop-a |
      | drop-b |
    When the rows are updated to the status "drop-key"
    Then the update is refused with a reason naming "items.update.one"
    And the rows hold:
      | name   | status |
      | drop-a |        |
      | drop-b |        |

  Scenario: a grouped hook deleting a field off the list is refused, writing nothing
    Given the rows:
      | name    |
      | strip-a |
    When the rows are updated to the status "strip-name"
    Then the update is refused with a reason naming "items.update.one"
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name    | status |
      | strip-a |        |

  Scenario: a grouped hook reading a field off the list is refused, writing nothing
    Given the rows:
      | name    |
      | check-a |
    When the rows are updated to the status "check-status"
    Then the update is refused with a reason naming "items.update.one"
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name    | status |
      | check-a |        |

  Scenario: a malformed key is refused before any update hook runs
    When a malformed key is updated to the status "archived"
    Then the update is refused with a reason naming "must be an integer"
    And no update event names the malformed key

  Scenario: a per-row hook cancels its row and its siblings are written
    Given the rows:
      | name      |
      | cancel-me |
      | c-two     |
      | c-three   |
    When the rows are updated to the status "archived"
    Then the update succeeds
    And the rows hold:
      | name      | status   |
      | cancel-me |          |
      | c-two     | archived |
      | c-three   | archived |
    And the per-row action names, in any order:
      | name    |
      | c-two   |
      | c-three |

  Scenario: a per-row hook rewriting one row splits its group, the rewrite written
    Given the rows:
      | name       |
      | d-one      |
      | rewrite-me |
      | d-three    |
    When the rows are updated to the status "archived"
    Then the update succeeds
    And the rows hold:
      | name      | status   |
      | d-one     | archived |
      | rewritten | archived |
      | d-three   | archived |
