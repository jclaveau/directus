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

  Every scenario also caches reads beside it and states their verdict, because a
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
      | marker | owner | method | note   | amount |
      | a1     | alpha | spaced | first  | 10     |
      | a3     | beta  | spaced | third  | 30     |
      | a4     | alpha | slow   | fourth | 40     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | alpha    |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker | owner |
      | a1     | alpha |
    And the following reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | beta               | spaced              |
      | id,owner | alpha              | slow                |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | a2     | beta  | spaced | second | 20     |
    Then the read is still cached
    And it answers:
      | marker | owner |
      | a1     | alpha |
    And the following reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | beta               | spaced              |
    And the following reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | alpha              | slow                |

  Scenario: a write matching every pin purges the read
    Given the slots:
      | marker | owner | method | note  | amount |
      | g1     | gamma | spaced | first | 10     |
      | g3     | gamma | slow   | third | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | gamma    |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker | owner |
      | g1     | gamma |
    And the following reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | gamma              | slow                |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | g2     | gamma | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | marker | owner |
      | g1     | gamma |
      | g2     | gamma |
    And the following reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | gamma              | slow                |

  Scenario: a write changing a field the read never named leaves it cached
    Given the slots:
      | marker | owner | method | note  | amount |
      | d1     | delta | spaced | first | 10     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | delta    |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker | owner |
      | d1     | delta |
    And the following reads are cached:
      | fields        | filter[owner][_eq] | filter[method][_eq] |
      | id,owner,note | delta              | spaced              |
    When slot "d1" is updated with note "rewritten"
    Then the read is still cached
    And it answers:
      | marker | owner |
      | d1     | delta |
    And the following reads are purged:
      | fields        | filter[owner][_eq] | filter[method][_eq] |
      | id,owner,note | delta              | spaced              |

  Scenario: a write changing a field the read sorted on purges it
    Given the slots:
      | marker | owner   | method | note  | amount |
      | e1     | epsilon | spaced | first | 10     |
    And this read is cached:
      | param              | value    |
      | fields             | id,owner |
      | filter[owner][_eq] | epsilon  |
      | sort               | note     |
    And the cached read answers:
      | marker | owner   |
      | e1     | epsilon |
    And the following reads are cached:
      | fields   | filter[owner][_eq] |
      | id,owner | epsilon            |
    When slot "e1" is updated with note "rewritten"
    Then the read is purged
    And it answers:
      | marker | owner   |
      | e1     | epsilon |
    And the following reads are still cached:
      | fields   | filter[owner][_eq] |
      | id,owner | epsilon            |

  Scenario: a read selecting every field is purged by any column change
    Given the slots:
      | marker | owner | method | note  | amount |
      | z1     | zeta  | spaced | first | 10     |
    And this read is cached:
      | param              | value |
      | fields             | *     |
      | filter[owner][_eq] | zeta  |
    And the cached read answers:
      | marker | owner | note  |
      | z1     | zeta  | first |
    And the following reads are cached:
      | fields   | filter[owner][_eq] |
      | id,owner | zeta               |
    When slot "z1" is updated with note "rewritten"
    Then the read is purged
    And it answers:
      | marker | owner | note      |
      | z1     | zeta  | rewritten |
    And the following reads are still cached:
      | fields   | filter[owner][_eq] |
      | id,owner | zeta               |

  Scenario: a read filtered on a range binds the field without pinning a value
    Given the slots:
      | marker | owner | method | note  | amount |
      | t1     | theta | spaced | first | 10     |
    And this read is cached:
      | param               | value           |
      | fields              | id,owner,amount |
      | filter[owner][_eq]  | theta           |
      | filter[amount][_gt] | 5               |
    And the cached read answers:
      | marker | owner | amount |
      | t1     | theta | 10     |
    And the following reads are cached:
      | fields        | filter[owner][_eq] |
      | id,owner,note | theta              |
    When slot "t1" is updated with note "rewritten"
    Then the read is still cached
    And it answers:
      | marker | owner | amount |
      | t1     | theta | 10     |
    And the following reads are purged:
      | fields        | filter[owner][_eq] |
      | id,owner,note | theta              |

  Scenario: a write to the field a range was read on purges it
    Given the slots:
      | marker | owner | method | note  | amount |
      | i1     | iota  | spaced | first | 10     |
    And this read is cached:
      | param               | value           |
      | fields              | id,owner,amount |
      | filter[owner][_eq]  | iota            |
      | filter[amount][_gt] | 5               |
    And the cached read answers:
      | marker | owner | amount |
      | i1     | iota  | 10     |
    And the following reads are cached:
      | fields   | filter[owner][_eq] |
      | id,owner | iota               |
    When slot "i1" is updated with amount 30
    Then the read is purged
    And it answers:
      | marker | owner | amount |
      | i1     | iota  | 30     |
    And the following reads are still cached:
      | fields   | filter[owner][_eq] |
      | id,owner | iota               |

  Scenario: a read filtered on a list of owners is purged by a write to any of them
    Given the slots:
      | marker | owner | method | note  | amount |
      | k1     | kappa | spaced | first | 10     |
    And this read is cached:
      | param              | value        |
      | fields             | id,owner     |
      | filter[owner][_in] | kappa,lambda |
    And the cached read answers:
      | marker | owner |
      | k1     | kappa |
    And the following reads are cached:
      | fields   | filter[owner][_in] |
      | id,owner | kappa              |
    When the slots are created:
      | marker | owner  | method | note   | amount |
      | k2     | lambda | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | marker | owner  |
      | k1     | kappa  |
      | k2     | lambda |
    And the following reads are still cached:
      | fields   | filter[owner][_in] |
      | id,owner | kappa              |

  Scenario: a read filtered on a list of owners survives a write outside it
    Given the slots:
      | marker | owner | method | note  | amount |
      | m1     | mu    | spaced | first | 10     |
    And this read is cached:
      | param              | value    |
      | fields             | id,owner |
      | filter[owner][_in] | mu,nu    |
    And the cached read answers:
      | marker | owner |
      | m1     | mu    |
    And the following reads are cached:
      | fields   | filter[owner][_in] |
      | id,owner | mu,xi              |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | m2     | xi    | spaced | second | 20     |
    Then the read is still cached
    And it answers:
      | marker | owner |
      | m1     | mu    |
    And the following reads are purged:
      | fields   | filter[owner][_in] |
      | id,owner | mu,xi              |

  Scenario: a row moving into the read's slice purges it
    Given the slots:
      | marker | owner   | method | note   | amount |
      | o1     | omicron | spaced | first  | 10     |
      | p1     | pi      | spaced | second | 20     |
      | o2     | omicron | slow   | third  | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | omicron  |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker | owner   |
      | o1     | omicron |
    And the following reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | pi                 | spaced              |
      | id,owner | omicron            | slow                |
    When slot "p1" is updated with owner "omicron"
    Then the read is purged
    And it answers:
      | marker | owner   |
      | o1     | omicron |
      | p1     | omicron |
    And the following reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | pi                 | spaced              |
    And the following reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | omicron            | slow                |

  Scenario: a row moving out of the read's slice purges it
    Given the slots:
      | marker | owner | method | note  | amount |
      | r1     | rho   | spaced | first | 10     |
      | r2     | rho   | slow   | third | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | rho      |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker | owner |
      | r1     | rho   |
    And the following reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | sigma              | spaced              |
      | id,owner | rho                | slow                |
    When slot "r1" is updated with owner "sigma"
    Then the read is purged
    And it answers nothing
    And the following reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | sigma              | spaced              |
    And the following reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | rho                | slow                |

  Scenario: a read matching two ways is purged by a write matching either
    Given the slots:
      | marker | owner | method | note  | amount |
      | v1     | tau   | slow   | first | 10     |
    And this read is cached:
      | param                       | value           |
      | fields                      | id,owner,method |
      | filter[_or][0][owner][_eq]  | tau             |
      | filter[_or][1][method][_eq] | spaced          |
    And the cached read answers:
      | marker | owner | method |
      | v1     | tau   | slow   |
    And the following reads are cached:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | tau                        | rushed                      |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | v2     | phi   | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | marker | owner | method |
      | v1     | tau   | slow   |
      | v2     | phi   | spaced |
    And the following reads are still cached:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | tau                        | rushed                      |

  Scenario: a read matching two ways survives a write matching neither
    Given the slots:
      | marker | owner | method | note  | amount |
      | w1     | omega | slow   | first | 10     |
    And this read is cached:
      | param                       | value           |
      | fields                      | id,owner,method |
      | filter[_or][0][owner][_eq]  | omega           |
      | filter[_or][1][method][_eq] | spaced          |
    And the cached read answers:
      | marker | owner | method |
      | w1     | omega | slow   |
    And the following reads are cached:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | omega                      | slow                        |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | w2     | koppa | slow   | second | 20     |
    Then the read is still cached
    And it answers:
      | marker | owner | method |
      | w1     | omega | slow   |
    And the following reads are purged:
      | fields          | filter[_or][0][owner][_eq] | filter[_or][1][method][_eq] |
      | id,owner,method | omega                      | slow                        |

  Scenario: a delete of a matching row purges the read
    Given the slots:
      | marker | owner   | method | note  | amount |
      | u1     | upsilon | spaced | first | 10     |
      | u2     | upsilon | slow   | third | 30     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | upsilon  |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker | owner   |
      | u1     | upsilon |
    And the following reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | upsilon            | slow                |
    When slot "u1" is deleted
    Then the read is purged
    And it answers nothing
    And the following reads are still cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | upsilon            | slow                |

  Scenario: a delete outside the read's slice leaves it cached
    Given the slots:
      | marker | owner | method | note   | amount |
      | c1     | chi   | spaced | first  | 10     |
      | c2     | psi   | spaced | second | 20     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | chi      |
      | filter[method][_eq] | spaced   |
    And the cached read answers:
      | marker | owner |
      | c1     | chi   |
    And the following reads are cached:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | psi                | spaced              |
    When slot "c2" is deleted
    Then the read is still cached
    And it answers:
      | marker | owner |
      | c1     | chi   |
    And the following reads are purged:
      | fields   | filter[owner][_eq] | filter[method][_eq] |
      | id,owner | psi                | spaced              |
