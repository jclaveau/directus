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

  A read is stated as the three things that make it one: the `query` it sends,
  the `response` it answers with, and the `fingerprints` it is filed under. The
  query is the `Query` the service receives rather than a URL encoding of it, and
  the fingerprints are the entry's own tags read back out of the index, so a
  scenario says which pins a read resolved instead of inferring them from what
  survived a purge. They carry no `collection`: every read here is of the one
  collection the Background declares, and the binder fills it in.

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
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |   owner: alpha        |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: alpha   |                       |       - alpha  |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    And the witness reads are cached:
      | query            | response               | fingerprints   |
      | fields:          | - marker: other_owner  | - pinnedScope: |+
      |   - id           |                        |     method:    |
      |   - owner        |                        |       - spaced |
      | filter:          |                        |     owner:     |
      |   owner: beta    |                        |       - beta   |
      |   method: spaced |                        |   viewFields:  |
      |                  |                        |     - id       |
      |                  |                        |     - method   |
      |                  |                        |     - owner    |
      | fields:          | - marker: other_method | - pinnedScope: |+
      |   - id           |                        |     method:    |
      |   - owner        |                        |       - slow   |
      | filter:          |                        |     owner:     |
      |   owner: alpha   |                        |       - alpha  |
      |   method: slow   |                        |   viewFields:  |
      |                  |                        |     - id       |
      |                  |                        |     - method   |
      |                  |                        |     - owner    |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | beta  | spaced | second | 20     |
    Then the read is still cached
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: alpha        |
    And the witness reads are purged:
      | query            | response               |
      | fields:          | - marker: other_owner  |+
      |   - id           | - marker: created_slot |
      |   - owner        |                        |
      | filter:          |                        |
      |   owner: beta    |                        |
      |   method: spaced |                        |
    And the witness reads are still cached:
      | query          | response               |
      | fields:        | - marker: other_method |+
      |   - id         |                        |
      |   - owner      |                        |
      | filter:        |                        |
      |   owner: alpha |                        |
      |   method: slow |                        |

  Scenario: a write matching every pin purges the read
    Given the slots:
      | marker       | owner | method | note  | amount |
      | target_slot  | gamma | spaced | first | 10     |
      | other_method | gamma | slow   | third | 30     |
    And this read is cached:
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |   owner: gamma        |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: gamma   |                       |       - gamma  |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    And the witness reads are cached:
      | query          | response               | fingerprints   |
      | fields:        | - marker: other_method | - pinnedScope: |+
      |   - id         |                        |     method:    |
      |   - owner      |                        |       - slow   |
      | filter:        |                        |     owner:     |
      |   owner: gamma |                        |       - gamma  |
      |   method: slow |                        |   viewFields:  |
      |                |                        |     - id       |
      |                |                        |     - method   |
      |                |                        |     - owner    |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | gamma | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | response               |
      | - marker: target_slot  |+
      |   owner: gamma         |
      | - marker: created_slot |
      |   owner: gamma         |
    And the witness reads are still cached:
      | query          | response               |
      | fields:        | - marker: other_method |+
      |   - id         |                        |
      |   - owner      |                        |
      | filter:        |                        |
      |   owner: gamma |                        |
      |   method: slow |                        |

  Scenario: a write changing a field the read never named leaves it cached
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | delta | spaced | first | 10     |
    And this read is cached:
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |   owner: delta        |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: delta   |                       |       - delta  |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    And the witness reads are cached:
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |                       |     method:    |
      |   - owner        |                       |       - spaced |
      |   - note         |                       |     owner:     |
      | filter:          |                       |       - delta  |
      |   owner: delta   |                       |   viewFields:  |
      |   method: spaced |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - note     |
      |                  |                       |     - owner    |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is still cached
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: delta        |
    And the witness reads are purged:
      | query            | response              |
      | fields:          | - marker: target_slot |+
      |   - id           |                       |
      |   - owner        |                       |
      |   - note         |                       |
      | filter:          |                       |
      |   owner: delta   |                       |
      |   method: spaced |                       |

  Scenario: a write changing a field the read sorted on purges it
    Given the slots:
      | marker      | owner   | method | note  | amount |
      | target_slot | epsilon | spaced | first | 10     |
    And this read is cached:
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           |   owner: epsilon      |     owner:      |
      |   - owner        |                       |       - epsilon |
      | filter:          |                       |   viewFields:   |
      |   owner: epsilon |                       |     - id        |
      | sort:            |                       |     - note      |
      |   - note         |                       |     - owner     |
    And the witness reads are cached:
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           |                       |     owner:      |
      |   - owner        |                       |       - epsilon |
      | filter:          |                       |   viewFields:   |
      |   owner: epsilon |                       |     - id        |
      |                  |                       |     - owner     |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is purged
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: epsilon      |
    And the witness reads are still cached:
      | query            | response              |
      | fields:          | - marker: target_slot |+
      |   - id           |                       |
      |   - owner        |                       |
      | filter:          |                       |
      |   owner: epsilon |                       |

  Scenario: a read selecting every field is purged by any column change
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | zeta  | spaced | first | 10     |
    And this read is cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - "*"       |   owner: zeta         |     owner:     |
      | filter:       |   note: first         |       - zeta   |
      |   owner: zeta |                       |   viewFields:  |
      |               |                       |     - amount   |
      |               |                       |     - id       |
      |               |                       |     - method   |
      |               |                       |     - note     |
      |               |                       |     - owner    |
    And the witness reads are cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |                       |     owner:     |
      |   - owner     |                       |       - zeta   |
      | filter:       |                       |   viewFields:  |
      |   owner: zeta |                       |     - id       |
      |               |                       |     - owner    |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is purged
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: zeta         |
      |   note: rewritten     |
    And the witness reads are still cached:
      | query         | response              |
      | fields:       | - marker: target_slot |+
      |   - id        |                       |
      |   - owner     |                       |
      | filter:       |                       |
      |   owner: zeta |                       |

  Scenario: a read filtered on a range binds the field without pinning a value
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | theta | spaced | first | 10     |
    And this read is cached:
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |   owner: theta        |     owner:     |
      |   - owner      |   amount: 10          |       - theta  |
      |   - amount     |                       |   viewFields:  |
      | filter:        |                       |     - amount   |
      |   owner: theta |                       |     - id       |
      |   amount:      |                       |     - owner    |
      |     _gt: 5     |                       |                |
    And the witness reads are cached:
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |                       |     owner:     |
      |   - owner      |                       |       - theta  |
      |   - note       |                       |   viewFields:  |
      | filter:        |                       |     - id       |
      |   owner: theta |                       |     - note     |
      |                |                       |     - owner    |
    When slot "target_slot" is updated with note "rewritten"
    Then the read is still cached
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: theta        |
      |   amount: 10          |
    And the witness reads are purged:
      | query          | response              |
      | fields:        | - marker: target_slot |+
      |   - id         |                       |
      |   - owner      |                       |
      |   - note       |                       |
      | filter:        |                       |
      |   owner: theta |                       |

  Scenario: a write to the field a range was read on purges it
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | iota  | spaced | first | 10     |
    And this read is cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |   owner: iota         |     owner:     |
      |   - owner     |   amount: 10          |       - iota   |
      |   - amount    |                       |   viewFields:  |
      | filter:       |                       |     - amount   |
      |   owner: iota |                       |     - id       |
      |   amount:     |                       |     - owner    |
      |     _gt: 5    |                       |                |
    And the witness reads are cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |                       |     owner:     |
      |   - owner     |                       |       - iota   |
      | filter:       |                       |   viewFields:  |
      |   owner: iota |                       |     - id       |
      |               |                       |     - owner    |
    When slot "target_slot" is updated with amount 30
    Then the read is purged
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: iota         |
      |   amount: 30          |
    And the witness reads are still cached:
      | query         | response              |
      | fields:       | - marker: target_slot |+
      |   - id        |                       |
      |   - owner     |                       |
      | filter:       |                       |
      |   owner: iota |                       |

  Scenario: a read filtered on a list of owners is purged by a write to any of them
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | kappa | spaced | first | 10     |
    And this read is cached:
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |                       |     owner:     |
      |   - owner      |                       |       - kappa  |
      | filter:        |                       |       - lambda |
      |   owner:       |                       |   viewFields:  |
      |     _in:       |                       |     - id       |
      |       - kappa  |                       |     - owner    |
      |       - lambda |                       |                |
    And the witness reads are cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |                       |     owner:     |
      |   - owner     |                       |       - kappa  |
      | filter:       |                       |   viewFields:  |
      |   owner:      |                       |     - id       |
      |     _in:      |                       |     - owner    |
      |       - kappa |                       |                |
    When the slots are created:
      | marker       | owner  | method | note   | amount |
      | created_slot | lambda | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | response               |
      | - marker: target_slot  |+
      |   owner: kappa         |
      | - marker: created_slot |
      |   owner: lambda        |
    And the witness reads are still cached:
      | query         | response              |
      | fields:       | - marker: target_slot |+
      |   - id        |                       |
      |   - owner     |                       |
      | filter:       |                       |
      |   owner:      |                       |
      |     _in:      |                       |
      |       - kappa |                       |

  Scenario: a read filtered on a list of owners survives a write outside it
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | mu    | spaced | first | 10     |
    And this read is cached:
      | query      | response              | fingerprints   |
      | fields:    | - marker: target_slot | - pinnedScope: |+
      |   - id     |                       |     owner:     |
      |   - owner  |                       |       - mu     |
      | filter:    |                       |       - nu     |
      |   owner:   |                       |   viewFields:  |
      |     _in:   |                       |     - id       |
      |       - mu |                       |     - owner    |
      |       - nu |                       |                |
    And the witness reads are cached:
      | query      | response              | fingerprints   |
      | fields:    | - marker: target_slot | - pinnedScope: |+
      |   - id     |                       |     owner:     |
      |   - owner  |                       |       - mu     |
      | filter:    |                       |       - xi     |
      |   owner:   |                       |   viewFields:  |
      |     _in:   |                       |     - id       |
      |       - mu |                       |     - owner    |
      |       - xi |                       |                |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | xi    | spaced | second | 20     |
    Then the read is still cached
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: mu           |
    And the witness reads are purged:
      | query      | response               |
      | fields:    | - marker: target_slot  |+
      |   - id     | - marker: created_slot |
      |   - owner  |                        |
      | filter:    |                        |
      |   owner:   |                        |
      |     _in:   |                        |
      |       - mu |                        |
      |       - xi |                        |

  Scenario: a row moving into the read's slice purges it
    Given the slots:
      | marker       | owner   | method | note   | amount |
      | target_slot  | omicron | spaced | first  | 10     |
      | other_owner  | pi      | spaced | second | 20     |
      | other_method | omicron | slow   | third  | 30     |
    And this read is cached:
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           |                       |     method:     |
      |   - owner        |                       |       - spaced  |
      | filter:          |                       |     owner:      |
      |   owner: omicron |                       |       - omicron |
      |   method: spaced |                       |   viewFields:   |
      |                  |                       |     - id        |
      |                  |                       |     - method    |
      |                  |                       |     - owner     |
    And the witness reads are cached:
      | query            | response               | fingerprints    |
      | fields:          | - marker: other_owner  | - pinnedScope:  |+
      |   - id           |                        |     method:     |
      |   - owner        |                        |       - spaced  |
      | filter:          |                        |     owner:      |
      |   owner: pi      |                        |       - pi      |
      |   method: spaced |                        |   viewFields:   |
      |                  |                        |     - id        |
      |                  |                        |     - method    |
      |                  |                        |     - owner     |
      | fields:          | - marker: other_method | - pinnedScope:  |+
      |   - id           |                        |     method:     |
      |   - owner        |                        |       - slow    |
      | filter:          |                        |     owner:      |
      |   owner: omicron |                        |       - omicron |
      |   method: slow   |                        |   viewFields:   |
      |                  |                        |     - id        |
      |                  |                        |     - method    |
      |                  |                        |     - owner     |
    When slot "other_owner" is updated with owner "omicron"
    Then the read is purged
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: omicron      |
      | - marker: other_owner |
      |   owner: omicron      |
    And the witness reads are purged:
      | query            | response |
      | fields:          | []       |+
      |   - id           |          |
      |   - owner        |          |
      | filter:          |          |
      |   owner: pi      |          |
      |   method: spaced |          |
    And the witness reads are still cached:
      | query            | response               |
      | fields:          | - marker: other_method |+
      |   - id           |                        |
      |   - owner        |                        |
      | filter:          |                        |
      |   owner: omicron |                        |
      |   method: slow   |                        |

  Scenario: a row moving out of the read's slice purges it
    Given the slots:
      | marker       | owner | method | note  | amount |
      | target_slot  | rho   | spaced | first | 10     |
      | other_method | rho   | slow   | third | 30     |
    And this read is cached:
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |                       |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: rho     |                       |       - rho    |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    And the witness reads are cached:
      | query            | response               | fingerprints   |
      | fields:          | []                     | - pinnedScope: |+
      |   - id           |                        |     method:    |
      |   - owner        |                        |       - spaced |
      | filter:          |                        |     owner:     |
      |   owner: sigma   |                        |       - sigma  |
      |   method: spaced |                        |   viewFields:  |
      |                  |                        |     - id       |
      |                  |                        |     - method   |
      |                  |                        |     - owner    |
      | fields:          | - marker: other_method | - pinnedScope: |+
      |   - id           |                        |     method:    |
      |   - owner        |                        |       - slow   |
      | filter:          |                        |     owner:     |
      |   owner: rho     |                        |       - rho    |
      |   method: slow   |                        |   viewFields:  |
      |                  |                        |     - id       |
      |                  |                        |     - method   |
      |                  |                        |     - owner    |
    When slot "target_slot" is updated with owner "sigma"
    Then the read is purged
    And it answers:
      | response |
      | []       |
    And the witness reads are purged:
      | query            | response              |
      | fields:          | - marker: target_slot |+
      |   - id           |                       |
      |   - owner        |                       |
      | filter:          |                       |
      |   owner: sigma   |                       |
      |   method: spaced |                       |
    And the witness reads are still cached:
      | query          | response               |
      | fields:        | - marker: other_method |+
      |   - id         |                        |
      |   - owner      |                        |
      | filter:        |                        |
      |   owner: rho   |                        |
      |   method: slow |                        |

  Scenario: a read matching two ways is purged by a write matching either
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | tau   | slow   | first | 10     |
    And this read is cached:
      | query                | response              | fingerprints   |
      | fields:              | - marker: target_slot | - pinnedScope: |+
      |   - id               |   owner: tau          |     owner:     |
      |   - owner            |   method: slow        |       - tau    |
      |   - method           |                       |   viewFields:  |
      | filter:              |                       |     - id       |
      |   _or:               |                       |     - method   |
      |     - owner: tau     |                       |     - owner    |
      |     - method: spaced |                       | - pinnedScope: |
      |                      |                       |     method:    |
      |                      |                       |       - spaced |
      |                      |                       |   viewFields:  |
      |                      |                       |     - id       |
      |                      |                       |     - method   |
      |                      |                       |     - owner    |
    And the witness reads are cached:
      | query                | response              | fingerprints   |
      | fields:              | - marker: target_slot | - pinnedScope: |+
      |   - id               |   owner: tau          |     owner:     |
      |   - owner            |   method: slow        |       - tau    |
      |   - method           |                       |   viewFields:  |
      | filter:              |                       |     - id       |
      |   _or:               |                       |     - method   |
      |     - owner: tau     |                       |     - owner    |
      |     - method: rushed |                       | - pinnedScope: |
      |                      |                       |     method:    |
      |                      |                       |       - rushed |
      |                      |                       |   viewFields:  |
      |                      |                       |     - id       |
      |                      |                       |     - method   |
      |                      |                       |     - owner    |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | phi   | spaced | second | 20     |
    Then the read is purged
    And it answers:
      | response               |
      | - marker: target_slot  |+
      |   owner: tau           |
      |   method: slow         |
      | - marker: created_slot |
      |   owner: phi           |
      |   method: spaced       |
    And the witness reads are still cached:
      | query                | response              |
      | fields:              | - marker: target_slot |+
      |   - id               |   owner: tau          |
      |   - owner            |   method: slow        |
      |   - method           |                       |
      | filter:              |                       |
      |   _or:               |                       |
      |     - owner: tau     |                       |
      |     - method: rushed |                       |

  Scenario: a read matching two ways survives a write matching neither
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | omega | slow   | first | 10     |
    And this read is cached:
      | query                | response              | fingerprints   |
      | fields:              | - marker: target_slot | - pinnedScope: |+
      |   - id               |   owner: omega        |     owner:     |
      |   - owner            |   method: slow        |       - omega  |
      |   - method           |                       |   viewFields:  |
      | filter:              |                       |     - id       |
      |   _or:               |                       |     - method   |
      |     - owner: omega   |                       |     - owner    |
      |     - method: spaced |                       | - pinnedScope: |
      |                      |                       |     method:    |
      |                      |                       |       - spaced |
      |                      |                       |   viewFields:  |
      |                      |                       |     - id       |
      |                      |                       |     - method   |
      |                      |                       |     - owner    |
    And the witness reads are cached:
      | query              | response              | fingerprints   |
      | fields:            | - marker: target_slot | - pinnedScope: |+
      |   - id             |   owner: omega        |     owner:     |
      |   - owner          |   method: slow        |       - omega  |
      |   - method         |                       |   viewFields:  |
      | filter:            |                       |     - id       |
      |   _or:             |                       |     - method   |
      |     - owner: omega |                       |     - owner    |
      |     - method: slow |                       | - pinnedScope: |
      |                    |                       |     method:    |
      |                    |                       |       - slow   |
      |                    |                       |   viewFields:  |
      |                    |                       |     - id       |
      |                    |                       |     - method   |
      |                    |                       |     - owner    |
    When the slots are created:
      | marker       | owner | method | note   | amount |
      | created_slot | koppa | slow   | second | 20     |
    Then the read is still cached
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: omega        |
      |   method: slow        |
    And the witness reads are purged:
      | query              | response               |
      | fields:            | - marker: target_slot  |+
      |   - id             |   owner: omega         |
      |   - owner          |   method: slow         |
      |   - method         | - marker: created_slot |
      | filter:            |   owner: koppa         |
      |   _or:             |   method: slow         |
      |     - owner: omega |                        |
      |     - method: slow |                        |

  Scenario: a delete of a matching row purges the read
    Given the slots:
      | marker       | owner   | method | note  | amount |
      | target_slot  | upsilon | spaced | first | 10     |
      | other_method | upsilon | slow   | third | 30     |
    And this read is cached:
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           |                       |     method:     |
      |   - owner        |                       |       - spaced  |
      | filter:          |                       |     owner:      |
      |   owner: upsilon |                       |       - upsilon |
      |   method: spaced |                       |   viewFields:   |
      |                  |                       |     - id        |
      |                  |                       |     - method    |
      |                  |                       |     - owner     |
    And the witness reads are cached:
      | query            | response               | fingerprints    |
      | fields:          | - marker: other_method | - pinnedScope:  |+
      |   - id           |                        |     method:     |
      |   - owner        |                        |       - slow    |
      | filter:          |                        |     owner:      |
      |   owner: upsilon |                        |       - upsilon |
      |   method: slow   |                        |   viewFields:   |
      |                  |                        |     - id        |
      |                  |                        |     - method    |
      |                  |                        |     - owner     |
    When slot "target_slot" is deleted
    Then the read is purged
    And it answers:
      | response |
      | []       |
    And the witness reads are still cached:
      | query            | response               |
      | fields:          | - marker: other_method |+
      |   - id           |                        |
      |   - owner        |                        |
      | filter:          |                        |
      |   owner: upsilon |                        |
      |   method: slow   |                        |

  Scenario: a delete outside the read's slice leaves it cached
    Given the slots:
      | marker      | owner | method | note   | amount |
      | target_slot | chi   | spaced | first  | 10     |
      | other_owner | psi   | spaced | second | 20     |
    And this read is cached:
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |                       |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: chi     |                       |       - chi    |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    And the witness reads are cached:
      | query            | response              | fingerprints   |
      | fields:          | - marker: other_owner | - pinnedScope: |+
      |   - id           |                       |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: psi     |                       |       - psi    |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    When slot "other_owner" is deleted
    Then the read is still cached
    And it answers:
      | response              |
      | - marker: target_slot |+
      |   owner: chi          |
    And the witness reads are purged:
      | query            | response |
      | fields:          | []       |+
      |   - id           |          |
      |   - owner        |          |
      | filter:          |          |
      |   owner: psi     |          |
      |   method: spaced |          |
