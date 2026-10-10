Feature: An update reaches its hooks as groups, then once per row

  Every update reaches its hooks as groups: one `items.update` event carrying
  `{ data, keys }[]`, then one `items.update.one` per row. The rows live in
  `test_update_groups`, whose events the update-groups-probe hook writes into a
  log read back here. A row is named by the `name` it was created with; a
  blank cell in what a batch sends leaves that field out, so the row sends its
  key alone. The log is emptied before each scenario.
  `test_update_groups_owner` holds rows too, and no update hook listens to it.
  `test_update_groups_slot` lets a holder hold each slot once (a unique
  `(holder, slot)`), and no update hook listens to it either.

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
    And the rows hold:
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

  Scenario: rows side by side carrying the same change are written together
    Given the rows:
      | name   |
      | next-a |
      | next-b |
      | next-c |
    When the batch sends:
      | name   | status   |
      | next-a | archived |
      | next-b | archived |
      | next-c | kept     |
    Then the grouped action carries:
      | status   | names               |
      | archived | ["next-a","next-b"] |
      | kept     | ["next-c"]          |

  Scenario: rows apart carrying the same change are written in the order sent
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
      | status   | names       |
      | archived | ["apart-a"] |
      | kept     | ["apart-b"] |
      | archived | ["apart-c"] |
    And the update events naming these rows are:
      | event            | phase  | count |
      | items.update     | filter | 1     |
      | items.update.one | filter | 3     |
      | items.update     | action | 1     |
      | items.update.one | action | 3     |

  Scenario: a batch writes its revisions in the order it sends its rows
    Given the rows, in the collection no update hook listens to:
      | name      |
      | ordered-a |
      | ordered-b |
      | ordered-c |
    When the batch sends:
      | name      | status   |
      | ordered-a | archived |
      | ordered-b | kept     |
      | ordered-c | archived |
    Then the update succeeds
    And the revisions name the rows in this order:
      | name      |
      | ordered-a |
      | ordered-b |
      | ordered-c |

  Scenario: a batch hands a slot over when a row frees it before the next takes it
    Given the rows, in the collection holding each slot once per holder:
      | name   | holder | slot |
      | hand-a | first  |      |
      | hand-b | second | open |
      | hand-c | second |      |
    When the batch sends the slots:
      | name   | slot   |
      | hand-a | open   |
      | hand-b | closed |
      | hand-c | open   |
    Then the update succeeds
    And the slots hold:
      | name   | holder | slot   |
      | hand-a | first  | open   |
      | hand-b | second | closed |
      | hand-c | second | open   |

  Scenario: a row a batch changes back and forth keeps the last change it was sent
    Given the rows:
      | name       |
      | back-forth |
    When the batch sends:
      | name       | status   |
      | back-forth | archived |
      | back-forth | kept     |
      | back-forth | archived |
    Then the update succeeds
    And the rows hold:
      | name       | status   |
      | back-forth | archived |

  Scenario: a row a non-admin sends twice with one change is checked and written once
    Given the rows:
      | name  |
      | twice |
    And the requests authenticate as a user who may read and update the rows
    When the batch sends:
      | name  | status   |
      | twice | archived |
      | twice | archived |
    Then the grouped action carries:
      | status   | names     |
      | archived | ["twice"] |
    And the rows hold:
      | name  | status   |
      | twice | archived |

  Scenario: a grouped hook answering with one payload is refused, naming the per-row event
    Given the rows:
      | name     |
      | legacy-a |
      | legacy-b |
    When the batch sends:
      | name     | status       |
      | legacy-a | archived     |
      | legacy-b | legacy-shape |
    Then the update is refused with a reason naming "items.update.one"
    And the rows hold:
      | name     | status       |
      | legacy-a |              |
      | legacy-b |              |

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
      | strip-b |
    When the batch sends:
      | name    | status     |
      | strip-a | archived   |
      | strip-b | strip-name |
    Then the update is refused with a reason naming "items.update.one"
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name    | status     |
      | strip-a |            |
      | strip-b |            |

  Scenario: a grouped hook reading a field off the list is refused, writing nothing
    Given the rows:
      | name    |
      | check-a |
      | check-b |
    When the batch sends:
      | name    | status       |
      | check-a | archived     |
      | check-b | check-status |
    Then the update is refused with a reason naming "items.update.one"
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name    | status       |
      | check-a |              |
      | check-b |              |

  Scenario: a malformed key is refused before any update hook runs
    When a malformed key is updated to the status "archived"
    Then the update is refused with a reason naming "must be an integer"
    And no update event was logged

  Scenario: an update naming no row runs no update hook
    When no row is updated to the status "archived"
    Then the update succeeds
    And no update event was logged

  Scenario: a batch no update hook listens to is written as it was sent
    Given the rows, in the collection no update hook listens to:
      | name   |
      | bare-a |
      | bare-b |
      | bare-c |
    When the batch sends:
      | name   | status   |
      | bare-a | archived |
      | bare-b | kept     |
      | bare-c | archived |
    Then the update answers:
      | name   | status   |
      | bare-a | archived |
      | bare-b | kept     |
      | bare-c | archived |
    And the rows hold:
      | name   | status   |
      | bare-a | archived |
      | bare-b | kept     |
      | bare-c | archived |
    And no update event was logged

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

  Scenario: a nested owner sent to several rows is created once, whatever the per-row hook
    Given the rows:
      | name    |
      | owned-a |
      | owned-b |
    When the rows are updated to point at a new owner named "shared-owner"
    Then the update succeeds
    And the rows point at the one owner named "shared-owner"
