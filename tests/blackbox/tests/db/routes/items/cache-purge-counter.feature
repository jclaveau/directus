Feature: A purge counter outlives the reads it guards

  A read takes its collection's purge counter before its query and again after
  its fill, and keeps the fill only when the two agree. A scoped write bumps the
  counter, and `CACHE_SCOPED_EPOCH_TTL` says how long it is held after.

  - A duration of 0 or less would expire the counter on the command that bumps
    it, so it is read as the 24h default.
  - A duration under 5 minutes could expire the counter under a slow read, so it
    is raised to 5 minutes.
  - A missing counter starts at the Redis clock in microseconds, sixteen digits:
    a counter recreated at 1 repeats a value a read may already have taken.

  Scenario: a purge counter held for 0 seconds is held for the 24h default
    Given an instance holding purge counters for "0"
    And the slots have no purge counter
    When a slot is created
    Then the slots' purge counter is held between 86340 and 86400 seconds

  Scenario: a purge counter held for 10 seconds is held for 5 minutes
    Given an instance holding purge counters for "10s"
    And the slots have no purge counter
    When a slot is created
    Then the slots' purge counter is held between 240 and 300 seconds

  Scenario: a missing purge counter starts at the Redis clock in microseconds
    Given an instance holding purge counters for "24h"
    And the slots have no purge counter
    When a slot is created
    Then the slots' purge counter reads sixteen digits
