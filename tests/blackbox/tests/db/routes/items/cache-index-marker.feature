Feature: The index-key sets are trusted again without waiting for the schedule

  A collection-wide purge reads the collection's index-key set only while the
  completeness marker names the index generation; otherwise it scans the
  keyspace. A flush drops the marker with the index, and only a reap writes it
  back. Here the reap is scheduled once a year, so any pass these scenarios see
  is one a flush or a boot asked for.

  A boot of a build other than the one the last boot recorded moves the
  generation, whatever CACHE_AUTO_FLUSH_ON_DEPLOY says, here off: a build rolled
  back to may have filed sets the index-key sets do not name.

  It also opens a fill pause of at most CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX, off
  everywhere but on the restarts that name one: through a rolling deploy the
  nodes of the build before go on filling, and neither build's purges reach
  every set the other files. It ends once no process of another build answers
  the processes query three looks in a row. A replica booting on the recorded
  build joins the pause running.

  Scenario: a flush with no reap scheduled has the index-key sets marked complete again
    Given these rows of index_marker_flush:
      | name | label |
      | ada  | old   |
    When the cache is flushed
    Then the index-key sets are marked complete at a generation after the flush
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    When every read of index_marker_flush is purged
    Then the purge read these index sets, in order:
      | command | keys                                        |
      | sscan   | swept-index-keys swept:index_marker_flush:* |
      | sscan   | collection-index-keys:index_marker_flush    |
      | sscan   | swept:index_marker_flush:<sweep>:1          |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: the wholesale counter expiring leaves the index-key sets trusted
    Given these rows of index_marker_counter:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are marked complete
    And the wholesale counter expires
    When every read of index_marker_counter is purged
    Then the purge read these index sets, in order:
      | command | keys                                          |
      | sscan   | swept-index-keys swept:index_marker_counter:* |
      | sscan   | collection-index-keys:index_marker_counter    |
      | sscan   | swept:index_marker_counter:<sweep>:1          |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: a restart on the same build leaves the marker vouching
    Given the index-key sets are marked complete
    And the marker is kept as it reads now
    When the instance restarts on the build marker-build-a
    Then the kept marker still names the index generation

  Scenario: a restart on another build takes the marker back, with auto-flush off
    Given the index-key sets are marked complete
    And the marker is kept as it reads now
    When the instance restarts on the build marker-build-b
    Then the kept marker no longer names the index generation

  Scenario: a restart on another build serves every read uncached while the build before answers
    Given these rows of index_marker_pause:
      | name | label |
      | ada  | old   |
    And a second instance runs on marker-build-b
    When the instance restarts on marker-build-c pausing fills for at most 2m
    Then these reads are not cached:
      | name | fields     |
      | ada  | name,label |
    And the fill pause left is kept as it reads now
    When the instance restarts on marker-build-c again
    Then the fill pause left is no longer than the kept one
    And these reads are not cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are not marked complete
    When the second instance stops
    Then the fill pause ends long before its ceiling
    And the index-key sets are marked complete
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
