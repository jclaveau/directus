Feature: A cache clear answers once the reap it asks for is over

  A clear drops the fingerprint index and asks for a reap, which walks the index
  a second later. A pass finding a member whose entry Redis does not hold yet
  cannot tell a fill still writing it from an entry that expired: it unnames the
  member and moves the collection's purge counter, and the fill in flight evicts
  the entry it wrote. A client clearing the cache and reading right after lost
  its fill that way, and read MISS where it had just filled.

  The clear now answers once that pass is over, so a read sent after the answer
  fills under no pass.

  - The instance talks to Redis through a proxy holding every entry write back
    for two seconds, so the read's fill is still writing when a pass a second
    after the clear would walk the index.
  - "owner" is the collection's scope field: the read files under "owner=alpha".

  Scenario: a read sent once a clear answered keeps its fill
    Given the rows of the collection:
      | markers  | owner | label |
      | target_1 | alpha | one   |
    When the cache is cleared
    And target_1's read fills while its entry write is held two seconds:
      | markers  | query              |
      | target_1 | fields:            |+
      |          |   - owner          |
      |          |   - label          |
      |          | filter:            |
      |          |   owner: "alpha"   |
    Then that read answered MISS
    And the next read of target_1 is a HIT, as no reap walked the index during its fill
