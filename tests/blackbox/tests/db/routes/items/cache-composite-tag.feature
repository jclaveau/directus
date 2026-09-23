Feature: A cached read is purged only by a write matching its whole fingerprint

  A read carries one tag per collection it touched, holding that read's whole
  fingerprint: every filter pair it pinned to a value, and every field it selected,
  sorted or filtered on. A write purges the entry only when every pair holds on the
  row it wrote — reading the row as it was or as it became — and only when it
  touched a field the read is bound to.

  Today each pair is a tag of its own and any one of them matching is enough, so a
  read of owner=alpha AND method=spaced is purged by every write carrying
  method=spaced, whoever owns it. That is what made a scoped read behave like a
  global one in production.

  Background:
    Given the slot collection:
      | field  | type    | scoped_cache_field |
      | owner  | string  | yes                |
      | method | string  | yes                |
      | note   | string  | no                 |
      | amount | integer | no                 |

  Scenario: a write matching one pair but not the other leaves the read cached
    Given the slots:
      | marker | owner | method | note  | amount |
      | a1     | alpha | spaced | first | 10     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | alpha    |
      | filter[method][_eq] | spaced   |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | a2     | beta  | spaced | second | 20     |
    Then the read is still cached

  Scenario: a write matching every pair purges the read
    Given the slots:
      | marker | owner | method | note  | amount |
      | g1     | gamma | spaced | first | 10     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | gamma    |
      | filter[method][_eq] | spaced   |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | g2     | gamma | spaced | second | 20     |
    Then the read is purged

  Scenario: a write changing a field the read never named leaves it cached
    Given the slots:
      | marker | owner | method | note  | amount |
      | d1     | delta | spaced | first | 10     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | delta    |
      | filter[method][_eq] | spaced   |
    When slot "d1" is updated with note "rewritten"
    Then the read is still cached

  Scenario: a write changing a field the read sorted on purges it
    Given the slots:
      | marker | owner   | method | note  | amount |
      | e1     | epsilon | spaced | first | 10     |
    And this read is cached:
      | param              | value    |
      | fields             | id,owner |
      | filter[owner][_eq] | epsilon  |
      | sort               | note     |
    When slot "e1" is updated with note "rewritten"
    Then the read is purged

  Scenario: a read selecting every field is purged by any column change
    Given the slots:
      | marker | owner | method | note  | amount |
      | z1     | zeta  | spaced | first | 10     |
    And this read is cached:
      | param              | value |
      | fields             | *     |
      | filter[owner][_eq] | zeta  |
    When slot "z1" is updated with note "rewritten"
    Then the read is purged

  Scenario: a read filtered on a range binds the field without pinning a value
    Given the slots:
      | marker | owner | method | note  | amount |
      | t1     | theta | spaced | first | 10     |
    And this read is cached:
      | param               | value           |
      | fields              | id,owner,amount |
      | filter[owner][_eq]  | theta           |
      | filter[amount][_gt] | 5               |
    When slot "t1" is updated with note "rewritten"
    Then the read is still cached

  Scenario: a write to the field a range was read on purges it
    Given the slots:
      | marker | owner | method | note  | amount |
      | i1     | iota  | spaced | first | 10     |
    And this read is cached:
      | param               | value           |
      | fields              | id,owner,amount |
      | filter[owner][_eq]  | iota            |
      | filter[amount][_gt] | 5               |
    When slot "i1" is updated with amount 30
    Then the read is purged

  Scenario: a read filtered on a list of owners is purged by a write to any of them
    Given the slots:
      | marker | owner | method | note  | amount |
      | k1     | kappa | spaced | first | 10     |
    And this read is cached:
      | param              | value        |
      | fields             | id,owner     |
      | filter[owner][_in] | kappa,lambda |
    When the slots are created:
      | marker | owner  | method | note   | amount |
      | k2     | lambda | spaced | second | 20     |
    Then the read is purged

  Scenario: a read filtered on a list of owners survives a write outside it
    Given the slots:
      | marker | owner | method | note  | amount |
      | m1     | mu    | spaced | first | 10     |
    And this read is cached:
      | param              | value    |
      | fields             | id,owner |
      | filter[owner][_in] | mu,nu    |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | m2     | xi    | spaced | second | 20     |
    Then the read is still cached

  Scenario: a row moving into the read's slice purges it
    Given the slots:
      | marker | owner   | method | note   | amount |
      | o1     | omicron | spaced | first  | 10     |
      | p1     | pi      | spaced | second | 20     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | omicron  |
      | filter[method][_eq] | spaced   |
    When slot "p1" is updated with owner "omicron"
    Then the read is purged

  Scenario: a row moving out of the read's slice purges it
    Given the slots:
      | marker | owner | method | note  | amount |
      | r1     | rho   | spaced | first | 10     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | rho      |
      | filter[method][_eq] | spaced   |
    When slot "r1" is updated with owner "sigma"
    Then the read is purged

  Scenario: a read matching two ways is purged by a write matching either
    Given the slots:
      | marker | owner   | method | note  | amount |
      | v1     | tau     | slow   | first | 10     |
    And this read is cached:
      | param                       | value           |
      | fields                      | id,owner,method |
      | filter[_or][0][owner][_eq]  | tau             |
      | filter[_or][1][method][_eq] | spaced          |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | v2     | phi   | spaced | second | 20     |
    Then the read is purged

  Scenario: a read matching two ways survives a write matching neither
    Given the slots:
      | marker | owner | method | note  | amount |
      | w1     | omega | slow   | first | 10     |
    And this read is cached:
      | param                       | value           |
      | fields                      | id,owner,method |
      | filter[_or][0][owner][_eq]  | omega           |
      | filter[_or][1][method][_eq] | spaced          |
    When the slots are created:
      | marker | owner | method | note   | amount |
      | w2     | koppa | slow   | second | 20     |
    Then the read is still cached

  Scenario: a delete of a matching row purges the read
    Given the slots:
      | marker | owner   | method | note  | amount |
      | u1     | upsilon | spaced | first | 10     |
    And this read is cached:
      | param               | value    |
      | fields              | id,owner |
      | filter[owner][_eq]  | upsilon  |
      | filter[method][_eq] | spaced   |
    When slot "u1" is deleted
    Then the read is purged

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
    When slot "c2" is deleted
    Then the read is still cached
