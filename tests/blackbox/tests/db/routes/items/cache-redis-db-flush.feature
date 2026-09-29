Feature: A response cache kept in its own Redis database is flushed with one FLUSHDB

  `CACHE_REDIS_DB` moves the response cache and the scoped-cache index into a
  Redis database of their own, and a flush empties it with one FLUSHDB instead of
  a scan of every key Redis holds. Locks, synchronization clocks and cache stats
  stay in the database `REDIS` selects, the shared one.

  - Database 7 is this feature's alone: every other spec shares database 0 of the
    same Redis, and a FLUSHDB there would wipe them mid-run.
  - A key outside every namespace is the witness: a namespaced clear leaves it,
    only a FLUSHDB takes it.
  - Every instance boots on a build no instance booted on before, so its boot
    flushes the cache.

  Scenario: a boot on a new build empties the cache database
    Given the cache database holds a key outside every namespace
    When an instance keeping its cache in database 7 boots on a new build
    Then the cache database no longer holds that key
    And the instance logs "FLUSHDB on redis db 7"
    And the shared database holds the build fingerprint
    And the cache database holds no lock

  Scenario: a cached read and its index are filed in the cache database
    Given an instance keeping its cache in database 7
    When a note read is cached
    Then the cache database holds the note's cached read and its index
    And the shared database holds neither

  Scenario: clearing the cache empties the cache database
    Given an instance keeping its cache in database 7
    And a note read is cached
    And a key outside every namespace is set in the cache database
    When the cache is cleared
    Then the cache database no longer holds that key
    And the next note read is a "MISS"
    And the shared database holds the build fingerprint

  Scenario: a write after the boot flush purges its slice
    Given an instance keeping its cache in database 7
    And a note read is cached
    When the note's label is changed to "v2"
    Then the next note read is a "MISS" showing "v2"

  Scenario: a cache database equal to the one REDIS selects is ignored
    Given an instance keeping its cache in database 0
    And a note read is cached
    And a key outside every namespace is set in the shared database
    When the cache is cleared
    Then the shared database still holds that key
    And the instance logs "CACHE_REDIS_DB=0 is not apart from the database"
    And the next note read is a "MISS"
