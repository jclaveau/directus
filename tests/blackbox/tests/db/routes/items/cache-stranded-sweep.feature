Feature: A sweep that died before dropping its entries is finished by the restart

  A whole-collection purge moves the collection's index sets aside, drops the
  entries they name, then releases them. A process dying in between leaves the
  moved sets behind with no record to retry: the failure was never caught. No
  write reads a moved set, so the entries it names stayed cached through every
  later write to their rows.

  The restart's first connection to Redis now drops the entries every moved set
  still names and releases the sets. The reads of `bob`, whose set was never
  moved, stay cached: the restart does not flush.

  Scenario: a read whose index set a dead sweep moved aside is purged on restart
    Given these rows of stranded_sweep:
      | name | label |
      | ada  | old   |
      | bob  | old   |
    And these reads are cached:
      | name | response                  |
      | ada  | [{name: ada, label: old}] |
      | bob  | [{name: bob, label: old}] |
    And a sweep moved the index set of this name aside, then died:
      | name |
      | ada  |
    When the label of ada is written:
      | label |
      | new   |
    And the process restarts
    Then these reads answer:
      | name | cache | response                  |
      | ada  | MISS  | [{name: ada, label: new}] |
      | bob  | HIT   | [{name: bob, label: old}] |
