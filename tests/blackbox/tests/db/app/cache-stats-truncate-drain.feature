Feature: A stats truncate leaves nothing a drain read before it

  A truncate empties the stats tables and the Redis stream their rows are
  drained from. A drain reads a batch off the stream and writes it to the
  tables after. A batch read before the truncate and written once the tables
  are empty brings back telemetry the truncate cleared: an entry read then
  named purges that predated its fill, on a cache it had just truncated.

  - A write to the collection queues its purge on the stream. Nothing drains
    it before the truncate: the drain schedule fires once a year.
  - A transaction holds `directus_cache_stats_scoped_entry_pins`, the last
    table the truncate empties, so the truncate waits there with the purges
    table already empty.
  - A stats read drains the stream before it answers.

  Scenario: a purge queued before a truncate is not stored after it
    Given a row created in the collection queued its purge on the stream
    And a transaction holds the last table the truncate empties
    When the stats truncate waits on that table
    And a stats read drains the stream meanwhile
    And the transaction ends
    Then the truncate answered 200
    And no purge of the collection is stored
