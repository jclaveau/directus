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

  A purge trusts the index-key sets only once a reap has walked the whole index
  and marked them complete, with the index generation as it read before its
  walk. Until then, and once a deploy has moved that generation, it scans the
  keyspace for the collection's sets as before the index-key sets existed. A
  flush moves neither: it unlinks the sets and keeps their names, which read
  empty until the pass it asks for releases them. Here the marking is done by
  hand, the reap being set to once a year; only a flush or a boot asks for a
  pass of its own.

  Scenario: a set created after the index-key set exists is purged with the collection
    Given these rows of index_keys_new:
      | name | label |
      | ada  | old   |
      | bob  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
      | bob  | name,label |
    And the index-key sets are marked complete
    When every read of index_keys_new is purged
    Then these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
      | bob  | name,label | MISS  |

  Scenario: a set whose name was lost is named again by the next fill into it
    Given these rows of index_keys_unnamed:
      | name | label |
      | ada  | old   |
      | bob  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
      | bob  | name,label |
    And the index-key sets are marked complete
    And the index-key set of index_keys_unnamed no longer names the set of ada
    Then the index-key set of index_keys_unnamed still names the set of bob, not the set of ada
    When these reads fill the same set:
      | name | fields |
      | ada  | name   |
    Then the index-key set of index_keys_unnamed names the set of ada again
    When every read of index_keys_unnamed is purged
    Then these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
      | ada  | name       | MISS  |
      | bob  | name,label | MISS  |

  Scenario: an index-key set that is gone is rebuilt by the next fill, with an expiry
    Given these rows of index_keys_gone:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are marked complete
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
      | 60000        |
    And the index-key set of index_keys_short still exists
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
      | 36000499     |
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
      | command | arguments                                                                                |
      | RENAME  | <index>fingerprint:index_keys_move:name=ada <index>swept:index_keys_move:<sweep>:1       |
      | SADD    | <index>swept-index-keys <index>swept:index_keys_move:<sweep>:1                           |
      | SREM    | <index>collection-index-keys:index_keys_move <index>fingerprint:index_keys_move:name=ada |
      | unlink  | <index>swept:index_keys_move:<sweep>:1                                                   |
      | srem    | <index>swept-index-keys <index>swept:index_keys_move:<sweep>:1                           |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: a purge reads the index-key set once the index-key sets are marked complete
    Given these rows of index_keys_marked:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are marked complete
    When every read of index_keys_marked is purged
    Then the purge read these index sets, in order:
      | command | arguments                                                                   |
      | sscan   | <index>swept-index-keys 0 MATCH <index>swept:index_keys_marked:* COUNT 1000 |
      | sscan   | <index>collection-index-keys:index_keys_marked 0 COUNT 1000                 |
      | sscan   | <index>swept:index_keys_marked:<sweep>:1 0 COUNT 1000                       |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: a set nothing names is purged while the index-key sets are not marked complete
    Given these rows of index_keys_unmarked:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are not marked complete
    And the index-key set of index_keys_unmarked no longer names the set of ada
    When every read of index_keys_unmarked is purged
    Then the purge read these index sets, in order:
      | command | arguments                                                                     |
      | sscan   | <index>swept-index-keys 0 MATCH <index>swept:index_keys_unmarked:* COUNT 1000 |
      | scan    | 0 MATCH <index>fingerprint:index_keys_unmarked:* COUNT 1000                   |
      | sscan   | <index>swept:index_keys_unmarked:<sweep>:1 0 COUNT 1000                       |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: a marker written before a flush still vouches after it
    Given these rows of index_keys_flushed:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are marked complete
    And the marker is kept as it reads now
    When the cache is flushed
    And the reap the flush asked for has released the names in index_keys_flushed
    Then the marker still reads as it was kept, naming the index generation
    And these reads are cached again:
      | name | fields     |
      | ada  | name,label |
    When every read of index_keys_flushed is purged
    Then the purge read these index sets, in order:
      | command | arguments                                                                    |
      | sscan   | <index>swept-index-keys 0 MATCH <index>swept:index_keys_flushed:* COUNT 1000 |
      | sscan   | <index>collection-index-keys:index_keys_flushed 0 COUNT 1000                 |
      | sscan   | <index>swept:index_keys_flushed:<sweep>:1 0 COUNT 1000                       |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  # Every scenario above scopes its collection on `name` alone, so each read it
  # caches is filed under the index path's set (`name=ada`). A read pinning the
  # primary key, or a scope field other than the index path, is filed under a
  # home pin's set instead (`pin:<field>=<value>`, the primary key ranked first,
  # then `scoped_cache_fields` in their declared order). These two scenarios
  # purge such a read through the index-key set, and check the metrics that the
  # purge read the index-key set rather than scanned the keyspace for it.

  Scenario: a read filed under its primary key's home pin is purged with the collection
    Given these rows, each written to its own collection:
      | markers   | collection         | id | owner | label |
      | target_1  | home_pin_key       | 1  | ann   | old   |
      | witness_1 | home_pin_untouched | 1  | ann   | old   |
    And these reads are cached, each in the set of its primary key, index path or home pin:
      | markers   | collection         | query     | set      |
      | target_1  | home_pin_key       | fields:   | pin:id=1 |+
      |           |                    |   - id    |          |
      |           |                    |   - label |          |
      |           |                    | filter:   |          |
      |           |                    |   id: 1   |          |
      | witness_1 | home_pin_untouched | fields:   | pin:id=1 |+
      |           |                    |   - id    |          |
      |           |                    |   - label |          |
      |           |                    | filter:   |          |
      |           |                    |   id: 1   |          |
    And the index-key set of home_pin_key names these sets, so the purge finds them there:
      | markers  | set      |
      | target_1 | pin:id=1 |
    And the index-key sets are marked complete, so a purge trusts them over a scan
    When every read of home_pin_key is purged
    Then the purge found its sets through the index-key set, not a scan of the keyspace:
      | mode     | grew |
      | scan     | no   |
      | registry | yes  |
    And these reads answer, the purged collection's gone and the other's still cached:
      | markers   | collection         | query     | cache |
      | target_1  | home_pin_key       | fields:   | MISS  |+
      |           |                    |   - id    |       |
      |           |                    |   - label |       |
      |           |                    | filter:   |       |
      |           |                    |   id: 1   |       |
      | witness_1 | home_pin_untouched | fields:   | HIT   |+
      |           |                    |   - id    |       |
      |           |                    |   - label |       |
      |           |                    | filter:   |       |
      |           |                    |   id: 1   |       |

  # `owner` is home_pin_second's index path, so a read of "label: x" pins no
  # index value and is filed under its home pin on `label`, the first scope field
  # it pins; a read of "owner: bob" beside it is filed under the index path's set.
  Scenario: a read filed under a second scope field's home pin is purged with the collection
    Given these rows, each written to its own collection:
      | markers   | collection         | id | owner | label |
      | target_1  | home_pin_second    | 1  | ann   | x     |
      | target_2  | home_pin_second    | 2  | bob   | y     |
      | witness_1 | home_pin_untouched | 2  | ann   | x     |
    And these reads are cached, each in the set of its primary key, index path or home pin:
      | markers   | collection         | query        | set         |
      | target_1  | home_pin_second    | fields:      | pin:label=x |+
      |           |                    |   - id       |             |
      |           |                    |   - label    |             |
      |           |                    | filter:      |             |
      |           |                    |   label: x   |             |
      | target_2  | home_pin_second    | fields:      | owner=bob   |+
      |           |                    |   - id       |             |
      |           |                    |   - owner    |             |
      |           |                    | filter:      |             |
      |           |                    |   owner: bob |             |
      | witness_1 | home_pin_untouched | fields:      | pin:label=x |+
      |           |                    |   - id       |             |
      |           |                    |   - label    |             |
      |           |                    | filter:      |             |
      |           |                    |   label: x   |             |
    And the index-key set of home_pin_second names these sets, so the purge finds them there:
      | markers  | set         |
      | target_1 | pin:label=x |
      | target_2 | owner=bob   |
    And the index-key sets are marked complete, so a purge trusts them over a scan
    When every read of home_pin_second is purged
    Then the purge found its sets through the index-key set, not a scan of the keyspace:
      | mode     | grew |
      | scan     | no   |
      | registry | yes  |
    And these reads answer, the purged collection's gone and the other's still cached:
      | markers   | collection         | query        | cache |
      | target_1  | home_pin_second    | fields:      | MISS  |+
      |           |                    |   - id       |       |
      |           |                    |   - label    |       |
      |           |                    | filter:      |       |
      |           |                    |   label: x   |       |
      | target_2  | home_pin_second    | fields:      | MISS  |+
      |           |                    |   - id       |       |
      |           |                    |   - owner    |       |
      |           |                    | filter:      |       |
      |           |                    |   owner: bob |       |
      | witness_1 | home_pin_untouched | fields:      | HIT   |+
      |           |                    |   - id       |       |
      |           |                    |   - label    |       |
      |           |                    | filter:      |       |
      |           |                    |   label: x   |       |
