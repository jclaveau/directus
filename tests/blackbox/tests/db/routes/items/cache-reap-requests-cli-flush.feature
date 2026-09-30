Feature: A flush from a one-shot command has the index-key sets marked complete again

  A collection-wide purge reads the collection's index-key set only while the
  completeness marker names the index generation; otherwise it scans the
  keyspace. A flush takes the marker back with the index, and only a reap
  writes it again. Here the reap is scheduled once a year, so the pass these
  scenarios wait for is one a flush asked for.

  "directus cache flush", "database migrate:*" and "schema apply" flush from a
  process that exits within milliseconds, before the reap its own flush asked
  for runs. The running node hears that flush's "cacheCleared" on the bus, and
  runs the reap itself.

  Scenario: a running node reaps after "directus cache flush" ran in another process
    Given the index-key sets are marked complete
    When "directus cache flush" runs in a process of its own
    Then the command exits 0
    And the index-key sets are marked complete at a generation after the flush
