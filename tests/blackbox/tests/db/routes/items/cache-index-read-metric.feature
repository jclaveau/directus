Feature: The metrics count which way a collection-wide purge found its sets

  directus_scoped_cache_index_reads_total counts the collection-wide reads of
  the index by mode: `registry` through the collection's index-key set, while
  the index-key sets are marked complete, and `scan`, a keyspace SCAN, while
  they are not. A `scan` count still rising long after a flush is a reap that
  never wrote the marker back. Here the reap is scheduled once a year, and the
  marker is dropped and written by hand once the boot's own pass wrote it.

  Scenario: a purge while the index-key sets are not marked complete counts a scan
    Given these rows of index_read_metric_scan:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are not marked complete
    When every read of index_read_metric_scan is purged
    Then the index reads the purge counted grew:
      | mode     | grew |
      | scan     | yes  |
      | registry | no   |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: a purge once the index-key sets are marked complete counts a registry read
    Given these rows of index_read_metric_registry:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are marked complete
    When every read of index_read_metric_registry is purged
    Then the index reads the purge counted grew:
      | mode     | grew |
      | scan     | no   |
      | registry | yes  |
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
