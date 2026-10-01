Feature: An update answers for every row it was sent, and refuses what it cannot write

  Every update reaches its hooks as groups: one `items.update` event carrying
  `{ data, keys }[]`, then one `items.update.one` per row. The rows live in
  `test_update_groups`, whose events the update-groups-probe hook writes into a
  log read back here. A row is named by the `name` it was created with.

  The probe answers the grouped event with a single payload, the shape it had
  before it carried groups, when a group sets the status "legacy-shape".

  Scenario: a batch where every row writes nothing answers with every row
    Given the rows:
      | name   |
      | noop-a |
      | noop-b |
    When the batch sends each row its key alone
    Then the update answers:
      | name   | status |
      | noop-a |        |
      | noop-b |        |

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

  Scenario: a grouped hook answering with one payload is refused, naming the per-row event
    Given the rows:
      | name   |
      | legacy |
    When the rows are updated to the status "legacy-shape"
    Then the update is refused with a reason naming "items.update.one"
    And the rows hold:
      | name   | status |
      | legacy |        |

  Scenario: a malformed key is refused before any update hook runs
    When a malformed key is updated to the status "archived"
    Then the update is refused with a reason naming "must be an integer"
    And no update event names the malformed key
