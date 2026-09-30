Feature: A flush from a one-shot command leaves the index-key sets trusted

  A collection-wide purge reads the collection's index-key set only while the
  completeness marker names the index generation; otherwise it scans the
  keyspace. A flush unlinks the index sets and keeps the index-key sets naming
  them and the marker: a name whose set is gone reads empty, so the marker
  still tells the truth. Only a changed build moves the generation. Here the
  reap is scheduled once a year, so the pass the scenario waits for is the one
  the boot asked for.

  "directus cache flush", "database migrate:*" and "schema apply" flush from a
  process that exits within milliseconds, before the reap its own flush asked
  for runs. The running node hears that flush's "cacheCleared" on the bus and
  asks for a reap the marker turns away, so the names the flush left wait for
  the next reap, and the purges keep reading the index-key sets meanwhile.

  Scenario: a running node keeps trusting the index-key sets after "directus cache flush" ran in another process
    Given the index-key sets are marked complete
    When "directus cache flush" runs in a process of its own
    Then the command exits 0
    And the index-key sets are still marked complete at the generation before the flush
