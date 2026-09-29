Feature: The members naming an expired entry are reaped from the index

  A read is filed in its collection's index set before it is cached, and the
  set outlives the entry: every later fill pushes its expiry out, so a set a
  collection keeps filing into never expires at all. Nothing removed a member
  whose entry had expired, so the set grew with every read ever cached, and
  every write to the collection tested each of them again.

  A scheduled job now removes the members whose entry the cache no longer
  holds. The read of `bob`, still cached, keeps its members: a write to bob
  still finds the read.

  A fill files its members before it writes its value, so a reap running between
  the two finds them naming nothing and takes them out: the value the fill then
  writes would be named by no index set. The reap moves the collection's counter
  first, and the fill, reading it moved, evicts what it wrote.

  Scenario: a read that expired leaves the index, a read still cached stays
    Given these rows of index_reap:
      | name | label |
      | ada  | old   |
      | bob  | old   |
    And the read of ada is cached, then expires
    And the read of bob is cached
    Then the index of index_reap names only the read of bob
    When the label of bob is written:
      | label |
      | new   |
    Then the read of bob is filled again:
      | response                  |
      | [{name: bob, label: new}] |

  Scenario: a pinned set loses the members of a read that expired
    Given these rows of index_reap_pinned:
      | name | label |
      | ada  | old   |
      | bob  | old   |
    And the read of ada is cached, then expires
    And the read of bob is cached
    Then the index set of ada is gone
    And the index set of bob still names the read of bob

  Scenario: a reap between a fill's index and its value evicts the entry
    Given these rows of index_reap_window:
      | name | label |
      | bob  | old   |
    When the read of bob is held between its index and its value, until a reap
    Then the read of bob answers:
      | cache | response                  |
      | MISS  | [{name: bob, label: old}] |
    When the label of bob is written:
      | label |
      | new   |
    Then the read of bob is filled again:
      | response                  |
      | [{name: bob, label: new}] |
