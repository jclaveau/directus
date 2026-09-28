Feature: The members naming an expired entry are reaped from the index

  A read is filed in its collection's index set before it is cached, and the
  set outlives the entry: every later fill pushes its expiry out, so a set a
  collection keeps filing into never expires at all. Nothing removed a member
  whose entry had expired, so the set grew with every read ever cached, and
  every write to the collection tested each of them again.

  A scheduled job now removes the members whose entry the cache no longer
  holds. The read of `bob`, still cached, keeps its members: a write to bob
  still finds the read.

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
