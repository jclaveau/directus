Feature: A boot flush releases the flush lock only while it holds it

  An instance booting on a new build flushes the cache, and one instance flushes
  at a time across the pool, under a lock that expires if its instance dies. A
  flush whose renewals were held up past the lock's TTL lost it to the next
  instance's claim, and deleted that instance's lock as it ended: a third
  instance could then claim it too, and two flushes walked the keyspace at once.
  A flush now releases the lock only while it names that flush.

  - The response cache holds 100000 entries, so the flush lasts long enough to
    be caught holding the lock.
  - Another instance taking the lock writes it only while it is there: the
    lock exists only while a flush holds it.

  Scenario: a boot flush releases the flush lock only while it holds it
    Given the response cache holds 100000 entries
    When another instance takes the flush lock while a boot on a new build flushes
    Then the boot flushed the 100000 entries
    And the flush lock still names the other instance, as the flush no longer held it
