Feature: A collection-wide purge reaches every set through the index-key set

  A purge that cannot tell which slices of a collection changed drops every read
  of the collection. It finds the collection's index sets through one set naming
  them, the collection's index-key set, rather than a scan of the keyspace. A set
  that set does not name keeps its reads cached through the purge.

  Every fill names each set it files into, the ones it creates and the ones
  that already exist: a set can outlive its name, when the index-key set was
  dropped after the set was filed, or a flush failed partway. And the index-key
  set is kept at least as long as every set it names, or none at all while one
  of them has no expiry: expiring first, it would lose them all at once.

  Scenario: a set created after the index-key set exists is purged with the collection
    Given these rows of index_keys_new:
      | name | label |
      | ada  | old   |
      | bob  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
      | bob  | name,label |
    When every read of index_keys_new is purged
    Then these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
      | bob  | name,label | MISS  |

  Scenario: a set whose name was lost is named again by the next fill into it
    Given these rows of index_keys_unnamed:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key set of index_keys_unnamed no longer names the set of ada
    And these reads fill the same set:
      | name | fields |
      | ada  | name   |
    When every read of index_keys_unnamed is purged
    Then these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
      | ada  | name       | MISS  |

  Scenario: an index-key set that is gone is rebuilt by the next fill, with an expiry
    Given these rows of index_keys_gone:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key set of index_keys_gone is gone
    And these reads fill the same set:
      | name | fields |
      | ada  | name   |
    Then the index-key set of index_keys_gone expires no sooner than the set of ada
    When every read of index_keys_gone is purged
    Then these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
      | ada  | name       | MISS  |

  Scenario: an index-key set expiring before its sets is kept longer by the next fill
    Given these rows of index_keys_short:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key set of index_keys_short is given this expiry:
      | milliseconds |
      | 2000         |
    And these reads fill the same set:
      | name | fields |
      | ada  | name   |
    Then the index-key set of index_keys_short expires no sooner than the set of ada

  Scenario: a set kept past this fill's expiry keeps the index-key set as long
    Given these rows of index_keys_long:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the set of ada is given this expiry:
      | milliseconds |
      | 36000000     |
    And these reads fill the same set:
      | name | fields |
      | ada  | name   |
    Then the index-key set of index_keys_long expires no sooner than the set of ada

  Scenario: a set with no expiry leaves the index-key set with none
    Given these rows of index_keys_unbounded:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the set of ada is given no expiry
    And these reads fill the same set:
      | name | fields |
      | ada  | name   |
    Then neither the index-key set of index_keys_unbounded nor the set of ada expires

  Scenario: a purge moves each set aside, names it, and releases both once its reads are gone
    Given these rows of index_keys_move:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    When every read of index_keys_move is purged
    Then the purge wrote these index sets, in order:
      | command | keys                                                                       |
      | rename  | fingerprint:index_keys_move:name=ada swept:index_keys_move:<sweep>:1       |
      | sadd    | swept-index-keys swept:index_keys_move:<sweep>:1                           |
      | srem    | collection-index-keys:index_keys_move fingerprint:index_keys_move:name=ada |
      | unlink  | swept:index_keys_move:<sweep>:1                                            |
      | srem    | swept-index-keys swept:index_keys_move:<sweep>:1                           |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
