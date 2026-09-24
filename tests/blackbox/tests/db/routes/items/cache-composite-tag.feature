Feature: A cached read is purged only by a write matching its whole fingerprint

  A read carries one tag per collection it touched, holding that read's whole
  fingerprint: every pin it resolved, and every field it selected, sorted or
  filtered on. A write purges the entry only when every pin holds on the row it
  wrote — reading the row as it was or as it became — and only when it touched a
  field the read is bound to.

  Today each pin is a tag of its own and any one of them matching is enough, so a
  read of owner=alpha AND method=spaced is purged by every write carrying
  method=spaced, whoever owns it. That is what made a scoped read behave like a
  global one in production.

  Every scenario states what the cached read answers when it is filled and what it
  answers once the write has landed, so a purge that never happened shows up as the
  stale body it served rather than as a header alone.

  Every scenario also caches witness reads and states their verdict, because a
  header on one entry proves neither half: a purge flushing the whole collection
  reads exactly like a narrow one, and a purge that never fires reads exactly like
  a read the write was right to leave alone.

  Background:
    Given the slot collection:
      | field  | type    | scoped_cache_field |
      | owner  | string  | yes                |
      | method | string  | yes                |
      | note   | string  | no                 |
      | amount | integer | no                 |

  Scenario: a write matching one pin but not the other leaves the read cached
    Given the slots:
      | marker       | owner | method | note   | amount |
      | target_slot  | alpha | spaced | first  | 10     |
      | other_owner  | beta  | spaced | third  | 30     |
      | other_method | alpha | slow   | fourth | 40     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | alpha    |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker      | owner |
      | target_slot | alpha |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | beta               | spaced              |
      | id,owner | alpha              | slow                |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | beta  | spaced | second | 20     |
    Then the read is still cached
    And it answers:
      | marker      | owner |
      | target_slot | alpha |
    And the witness reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | beta               | spaced              |
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | alpha              | slow                |

  Scenario: a write matching every pin purges the read
    Given the slots:
      | marker       | owner | method | note  | amount |
      | target_slot  | gamma | spaced | first | 10     |
      | other_method | gamma | slow   | third | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | gamma    |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker      | owner |
      | target_slot | gamma |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | gamma              | slow                |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | gamma | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | marker       | owner |
      | target_slot  | gamma |
      | created_slot | gamma |
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | gamma              | slow                |

  Scenario: a write changing a field the read never named leaves it cached
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | delta | spaced | first | 10     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | delta    |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker      | owner |
      | target_slot | delta |
    And the witness reads are cached:
      | fields        | filter[owner][_eq] | filter[method][_eq] |
      | id,owner,note | delta              | spaced              |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is still cached
    And it answers:
      | marker      | owner |
      | target_slot | delta |
    And the witness reads are purged:
      | fields        | filter[owner][_eq] | filter[method][_eq] |
      | id,owner,note | delta              | spaced              |

  Scenario: a write changing a field the read sorted on purges it
    Given the slots:
      | marker      | owner   | method | note  | amount |
      | target_slot | epsilon | spaced | first | 10     |
    And this read is cached:
      | param              | value    |
      | fields             | id,owner |
      | filter[owner][_eq] | epsilon  |
      | sort               | note     |
    And the cached read answers:
      | marker      | owner   |
      | target_slot | epsilon |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] |
      | id,owner | epsilon            |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is purged
    And it answers:
      | marker      | owner   |
      | target_slot | epsilon |
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] |
      | id,owner | epsilon            |

  Scenario: a read selecting every field is purged by any column change
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | zeta  | spaced | first | 10     |
    And this read is cached:
      | param              | value |
      | fields             | *     |
      | filter[owner][_eq] | zeta  |
    And the cached read answers:
      | marker      | owner | note  |
      | target_slot | zeta  | first |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] |
      | id,owner | zeta               |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is purged
    And it answers:
      | marker      | owner | note      |
      | target_slot | zeta  | rewritten |
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] |
      | id,owner | zeta               |

  Scenario: a read filtered on a range binds the field without pinning a value
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | theta | spaced | first | 10     |
    And this read is cached:
      | param               | value           |
      | fields              | id,owner,amount |
      | filter[owner][_eq]  | theta           |
      | filter[amount][_gt] | 5               |
    And the cached read answers:
      | marker      | owner | amount |
      | target_slot | theta | 10     |
    And the witness reads are cached:
      | fields        | filter[owner][_eq] |
      | id,owner,note | theta              |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is still cached
    And it answers:
      | marker      | owner | amount |
      | target_slot | theta | 10     |
    And the witness reads are purged:
      | fields        | filter[owner][_eq] |
      | id,owner,note | theta              |

  Scenario: a write to the field a range was read on purges it
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | iota  | spaced | first | 10     |
    And this read is cached:
      | param               | value           |
      | fields              | id,owner,amount |
      | filter[owner][_eq]  | iota            |
      | filter[amount][_gt] | 5               |
    And the cached read answers:
      | marker      | owner | amount |
      | target_slot | iota  | 10     |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] |
      | id,owner | iota               |
    When slot "target_slot" is updated with amount 30
    Then the read is purged
    And it answers:
      | marker      | owner | amount |
      | target_slot | iota  | 30     |
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] |
      | id,owner | iota               |

  Scenario: a read filtered on a list of owners is purged by a write to any of them
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | kappa | spaced | first | 10     |
    And this read is cached:
      | param              | value        |
      | fields             | id,owner     |
      | filter[owner][_in] | kappa,lambda |
    And the cached read answers:
      | marker      | owner |
      | target_slot | kappa |
    And the witness reads are cached:
      | fields   | filter[owner][_in] |
      | id,owner | kappa              |
    When the slots are created:
      | marker       | owner  | method | note   | amount |
      | created_slot | lambda | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | marker       | owner  |
      | target_slot  | kappa  |
      | created_slot | lambda |
    And the witness reads are still cached:
      | fields   | filter[owner][_in] |
      | id,owner | kappa              |

  Scenario: a read filtered on a list of owners survives a write outside it
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | mu    | spaced | first | 10     |
    And this read is cached:
      | param              | value    |
      | fields             | id,owner |
      | filter[owner][_in] | mu,nu    |
    And the cached read answers:
      | marker      | owner |
      | target_slot | mu    |
    And the witness reads are cached:
      | fields   | filter[owner][_in] |
      | id,owner | mu,xi              |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | xi    | spaced | second | 20     |
    Then the read is still cached
    And it answers:
      | marker      | owner |
      | target_slot | mu    |
    And the witness reads are purged:
      | fields   | filter[owner][_in] |
      | id,owner | mu,xi              |

  Scenario: a row moving into the read's slice purges it
    Given the slots:
      | marker       | owner   | method | note   | amount |
      | target_slot  | omicron | spaced | first  | 10     |
      | other_owner  | pi      | spaced | second | 20     |
      | other_method | omicron | slow   | third  | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | omicron  |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker      | owner   |
      | target_slot | omicron |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | pi                 | spaced              |
      | id,owner | omicron            | slow                |
    When slot "other_owner" is updated with owner "omicron"
    Then the read is purged
    And it answers:
      | marker      | owner   |
      | target_slot | omicron |
      | other_owner | omicron |
    And the witness reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | pi                 | spaced              |
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | omicron            | slow                |

  Scenario: a row moving out of the read's slice purges it
    Given the slots:
      | marker       | owner | method | note  | amount |
      | target_slot  | rho   | spaced | first | 10     |
      | other_method | rho   | slow   | third | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | rho      |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker      | owner |
      | target_slot | rho   |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | sigma              | spaced              |
      | id,owner | rho                | slow                |
    When slot "target_slot" is updated with owner "sigma"
    Then the read is purged
    And it answers nothing
    And the witness reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | sigma              | spaced              |
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | rho                | slow                |

  Scenario: a read matching two ways is purged by a write matching either
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | tau   | slow   | first | 10     |
    And this read is cached:
      | param                       | value           |
      | fields                      | id,owner,method |
      | filter[_or][0][owner][_eq]  | tau             |
      | filter[_or][1][method][_eq] | spaced          |
    And the cached read answers:
      | marker      | owner | method |
      | target_slot | tau   | slow   |
    And the witness reads are cached:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | tau                        | rushed                      |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | phi   | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | marker       | owner | method |
      | target_slot  | tau   | slow   |
      | created_slot | phi   | spaced |
    And the witness reads are still cached:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | tau                        | rushed                      |

  Scenario: a read matching two ways survives a write matching neither
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | omega | slow   | first | 10     |
    And this read is cached:
      | param                       | value           |
      | fields                      | id,owner,method |
      | filter[_or][0][owner][_eq]  | omega           |
      | filter[_or][1][method][_eq] | spaced          |
    And the cached read answers:
      | marker      | owner | method |
      | target_slot | omega | slow   |
    And the witness reads are cached:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | omega                      | slow                        |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | koppa | slow   | second | 20     |
    Then the read is still cached
    And it answers:
      | marker      | owner | method |
      | target_slot | omega | slow   |
    And the witness reads are purged:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | omega                      | slow                        |

  Scenario: a delete of a matching row purges the read
    Given the slots:
      | marker       | owner   | method | note  | amount |
      | target_slot  | upsilon | spaced | first | 10     |
      | other_method | upsilon | slow   | third | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | upsilon  |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker      | owner   |
      | target_slot | upsilon |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | upsilon            | slow                |
    When slot "target_slot" is deleted
    Then the read is purged
    And it answers nothing
    And the witness reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | upsilon            | slow                |

  Scenario: a delete outside the read's slice leaves it cached
    Given the slots:
      | marker      | owner | method | note   | amount |
      | target_slot | chi   | spaced | first  | 10     |
      | other_owner | psi   | spaced | second | 20     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | chi      |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker      | owner |
      | target_slot | chi   |
    And the witness reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | psi                | spaced              |
    When slot "other_owner" is deleted
    Then the read is still cached
    And it answers:
      | marker      | owner |
      | target_slot | chi   |
    And the witness reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | psi                | spaced              |
