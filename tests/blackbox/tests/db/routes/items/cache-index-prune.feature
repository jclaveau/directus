Feature: The members naming an expired entry are pruned from the index

  A read is filed in its collection's index set before it is cached, and the
  set outlives the entry: every later fill pushes its expiry out, so a set a
  collection keeps filing into never expires at all. Nothing removed a member
  whose entry had expired, so the set grew with every read ever cached, and
  every write to the collection tested each of them again.

  Each member is now scored with an expiry never earlier than its entry's, and
  a purge drops the members whose expiry has passed from every set it reads
  before reading it. The read of `bob`, still cached, keeps its members: a
  write to bob still finds the read.

  A fill files its members before it writes its value, so a fill held between
  the two for longer than its index allows would write a value outliving its
  members. The fill measures how long it took, and evicts what it wrote.

  Scenario: a read that expired leaves the index, a read still cached stays
    Given these rows of index_prune:
      | name | label |
      | ada  | old   |
      | bob  | old   |
      | cy   | old   |
    And the read of ada is cached, then its index members expire
    And the read of bob is cached
    When the label of cy is written:
      | label |
      | new   |
    Then the index of index_prune names only the read of bob
    And the read of bob answers:
      | cache | response                  |
      | HIT   | [{name: bob, label: old}] |
    When the label of bob is written:
      | label |
      | new   |
    Then the read of bob is filled again:
      | response                  |
      | [{name: bob, label: new}] |

  Scenario: a pinned set loses the members of a read that expired
    Given these rows of index_prune_pinned:
      | name | label |
      | ada  | old   |
      | bob  | old   |
    And the read of ada is cached, then its index members expire
    And the read of bob is cached
    Then the index set of ada is gone
    And the index set of bob still names the read of bob

  Scenario: a fill held past its index's expiry evicts the entry
    Given these rows of index_prune_window:
      | name | label |
      | bob  | old   |
    When the read of bob is held between its index and its value, past one TTL
    Then the read of bob answers:
      | cache | response                  |
      | MISS  | [{name: bob, label: old}] |
    And the read of bob is filled again:
      | response                  |
      | [{name: bob, label: old}] |
