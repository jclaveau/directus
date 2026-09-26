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
  the `response` it answers with, and the `fingerprints` it is filed under —
  every time the feature names a read, whether it is caching one or reading one
  back after the write. The query is the `Query` the service receives rather than
  a URL encoding of it, and the fingerprints are the entry's own tags read back
  out of the index, so a scenario says which pins a read resolved instead of
  inferring them from what survived a purge. A fingerprint of the collection the
  Background declares carries no `collection`, and the binder fills it in; the
  last two scenarios read collections of their own, whose `scoped_cache_fields`
  compose into paths, so every fingerprint there names its `collection`.

  A write is stated the way a read is. The `query` cell names the row it writes
  and, under `data`, the body its request carries: every column on a create, the
  ones it changes on an update, none at all on a delete. Beside it stand the
  `purged fingerprints` it dropped from the index on its way through, which is
  the other half of the same ledger. A write removes exactly the members whose
  pins hold on a row it wrote, reading that row as it was and as it became, so a
  scenario says which fingerprints the write reached rather than only which
  entries stopped answering. An entry filed under two — a read matching two ways
  — loses only the one the row matched, and states only that one here.

  Every verdict step says why it fell that way: the pins the write matched on the
  row it wrote, the pin it did not match, or the field it wrote that the read
  never selected. Those are the three things the rule turns on, so a scenario
  reads as a sentence rather than as a table the reader has to apply the rule to.

  The rows a write writes are stated as YAML in a multiline cell, the way
  responses and fingerprints are, so the write can carry the fingerprints it
  purged in a column beside them. The rows a scenario starts from carry nothing
  beside them and stay an ordinary table.

  Every scenario states what the cached read answers when it is filled and what it
  answers once the write has landed, so a purge that never happened shows up as the
  stale body it served rather than as a header alone.

  Every scenario also caches witness reads and states their verdict, because a
  header on one entry proves neither half: a purge flushing the whole collection
  reads exactly like a narrow one, and a purge that never fires reads exactly like
  a read the write was right to leave alone.

  Background:
    Given the slot collection:
      | field        | type    | scoped_cache_field  |
      | owner        | string  | yes                 |
      | method       | string  | yes                 |
      | method_range | integer | method_range.method |
      | note         | string  | no                  |
      | amount       | integer | no                  |

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
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     method:         |
      |     owner: beta        |       - spaced      |
      |     method: spaced     |     owner:          |
      |     note: second       |       - beta        |
      |     amount: 20         |   viewFields:       |
      |                        |     - id            |
      |                        |     - method        |
      |                        |     - owner         |
    Then the read is still cached, not matching "owner: alpha":
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
    And the witness reads are purged, matching "method: spaced, owner: beta":
      | query            | response               | fingerprints   |
      | fields:          | - marker: other_owner  | - pinnedScope: |+
      |   - id           | - marker: created_slot |     method:    |
      |   - owner        |                        |       - spaced |
      | filter:          |                        |     owner:     |
      |   owner: beta    |                        |       - beta   |
      |   method: spaced |                        |   viewFields:  |
      |                  |                        |     - id       |
      |                  |                        |     - method   |
      |                  |                        |     - owner    |
    And the witness reads are still cached, not matching "method: slow":
      | query          | response               | fingerprints   |
      | fields:        | - marker: other_method | - pinnedScope: |+
      |   - id         |                        |     method:    |
      |   - owner      |                        |       - slow   |
      | filter:        |                        |     owner:     |
      |   owner: alpha |                        |       - alpha  |
      |   method: slow |                        |   viewFields:  |
      |                |                        |     - id       |
      |                |                        |     - method   |
      |                |                        |     - owner    |

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
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     method:         |
      |     owner: gamma       |       - spaced      |
      |     method: spaced     |     owner:          |
      |     note: second       |       - gamma       |
      |     amount: 20         |   viewFields:       |
      |                        |     - id            |
      |                        |     - method        |
      |                        |     - owner         |
    Then the read is purged, matching "method: spaced, owner: gamma":
      | query            | response               | fingerprints   |
      | fields:          | - marker: target_slot  | - pinnedScope: |+
      |   - id           |   owner: gamma         |     method:    |
      |   - owner        | - marker: created_slot |       - spaced |
      | filter:          |   owner: gamma         |     owner:     |
      |   owner: gamma   |                        |       - gamma  |
      |   method: spaced |                        |   viewFields:  |
      |                  |                        |     - id       |
      |                  |                        |     - method   |
      |                  |                        |     - owner    |
    And the witness reads are still cached, not matching "method: slow":
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

  Scenario: a pinned value carrying a separator purges only its own read
    Given the slots:
      | marker      | owner   | method | note  | amount |
      | target_slot | a\|b,c  | spaced | first | 10     |
      | other_owner | a\|b    | spaced | third | 30     |
    And this read is cached:
      | query              | response              | fingerprints   |
      | fields:            | - marker: target_slot | - pinnedScope: |+
      |   - id             |   owner: 'a\|b,c'     |     method:    |
      |   - owner          |                       |       - spaced |
      | filter:            |                       |     owner:     |
      |   owner: 'a\|b,c'  |                       |       - 'a\|b,c' |
      |   method: spaced   |                       |   viewFields:  |
      |                    |                       |     - id       |
      |                    |                       |     - method   |
      |                    |                       |     - owner    |
    And the witness reads are cached:
      | query            | response              | fingerprints   |
      | fields:          | - marker: other_owner | - pinnedScope: |+
      |   - id           |   owner: 'a\|b'       |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: 'a\|b'  |                       |       - 'a\|b' |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    When the slots are created:
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     method:         |
      |     owner: 'a\|b,c'    |       - spaced      |
      |     method: spaced     |     owner:          |
      |     note: second       |       - 'a\|b,c'    |
      |     amount: 20         |   viewFields:       |
      |                        |     - id            |
      |                        |     - method        |
      |                        |     - owner         |
    Then the read is purged, matching the owner "a|b,c":
      | query              | response               | fingerprints   |
      | fields:            | - marker: target_slot  | - pinnedScope: |+
      |   - id             |   owner: 'a\|b,c'      |     method:    |
      |   - owner          | - marker: created_slot |       - spaced |
      | filter:            |   owner: 'a\|b,c'      |     owner:     |
      |   owner: 'a\|b,c'  |                        |       - 'a\|b,c' |
      |   method: spaced   |                        |   viewFields:  |
      |                    |                        |     - id       |
      |                    |                        |     - method   |
      |                    |                        |     - owner    |
    And the witness reads are still cached, not matching the owner "a|b":
      | query            | response              | fingerprints   |
      | fields:          | - marker: other_owner | - pinnedScope: |+
      |   - id           |   owner: 'a\|b'       |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: 'a\|b'  |                       |       - 'a\|b' |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |

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
      |   - id           |   note: first         |     method:    |
      |   - owner        |                       |       - spaced |
      |   - note         |                       |     owner:     |
      | filter:          |                       |       - delta  |
      |   owner: delta   |                       |   viewFields:  |
      |   method: spaced |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - note     |
      |                  |                       |     - owner    |
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |   data:               |     method:         |
      |     note: rewritten   |       - spaced      |
      |                       |     owner:          |
      |                       |       - delta       |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - method        |
      |                       |     - note          |
      |                       |     - owner         |
    Then the read is still cached, not reading "note":
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
    And the witness reads are purged, matching "method: spaced, owner: delta":
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |   note: rewritten     |     method:    |
      |   - owner        |                       |       - spaced |
      |   - note         |                       |     owner:     |
      | filter:          |                       |       - delta  |
      |   owner: delta   |                       |   viewFields:  |
      |   method: spaced |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - note     |
      |                  |                       |     - owner    |

  Scenario: a write changing a field the read sorted on purges it
    Given the slots:
      | marker      | owner   | method | note   | amount |
      | target_slot | epsilon | spaced | first  | 10     |
      | other_slot  | epsilon | spaced | second | 20     |
    And this read is cached:
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           |   owner: epsilon      |     owner:      |
      |   - owner        | - marker: other_slot  |       - epsilon |
      | filter:          |   owner: epsilon      |   viewFields:   |
      |   owner: epsilon |                       |     - id        |
      | sort:            |                       |     - note      |
      |   - note         |                       |     - owner     |
    And the witness reads are cached:
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           | - marker: other_slot  |     owner:      |
      |   - owner        |                       |       - epsilon |
      | filter:          |                       |   viewFields:   |
      |   owner: epsilon |                       |     - id        |
      |                  |                       |     - owner     |
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |   data:               |     owner:          |
      |     note: third       |       - epsilon     |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - note          |
      |                       |     - owner         |
    Then the read is purged, matching "owner: epsilon":
      | query            | response              | fingerprints    |
      | fields:          | - marker: other_slot  | - pinnedScope:  |+
      |   - id           |   owner: epsilon      |     owner:      |
      |   - owner        | - marker: target_slot |       - epsilon |
      | filter:          |   owner: epsilon      |   viewFields:   |
      |   owner: epsilon |                       |     - id        |
      | sort:            |                       |     - note      |
      |   - note         |                       |     - owner     |
    And the witness reads are still cached, not reading "note":
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           | - marker: other_slot  |     owner:      |
      |   - owner        |                       |       - epsilon |
      | filter:          |                       |   viewFields:   |
      |   owner: epsilon |                       |     - id        |
      |                  |                       |     - owner     |

  Scenario: a read selecting every field is purged by any column change
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | zeta  | spaced | first | 10     |
    And this read is cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - "*"       |   owner: zeta         |     owner:     |
      | filter:       |   note: first         |       - zeta   |
      |   owner: zeta |                       |                |
    And the witness reads are cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |                       |     owner:     |
      |   - owner     |                       |       - zeta   |
      | filter:       |                       |   viewFields:  |
      |   owner: zeta |                       |     - id       |
      |               |                       |     - owner    |
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |   data:               |     owner:          |
      |     note: rewritten   |       - zeta        |
    Then the read is purged, matching "owner: zeta":
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - "*"       |   owner: zeta         |     owner:     |
      | filter:       |   note: rewritten     |       - zeta   |
      |   owner: zeta |                       |                |
    And the witness reads are still cached, not reading "note":
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |                       |     owner:     |
      |   - owner     |                       |       - zeta   |
      | filter:       |                       |   viewFields:  |
      |   owner: zeta |                       |     - id       |
      |               |                       |     - owner    |

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
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |   data:               |     owner:          |
      |     note: rewritten   |       - theta       |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - note          |
      |                       |     - owner         |
    Then the read is still cached, not reading "note":
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |   owner: theta        |     owner:     |
      |   - owner      |   amount: 10          |       - theta  |
      |   - amount     |                       |   viewFields:  |
      | filter:        |                       |     - amount   |
      |   owner: theta |                       |     - id       |
      |   amount:      |                       |     - owner    |
      |     _gt: 5     |                       |                |
    And the witness reads are purged, matching "owner: theta":
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |                       |     owner:     |
      |   - owner      |                       |       - theta  |
      |   - note       |                       |   viewFields:  |
      | filter:        |                       |     - id       |
      |   owner: theta |                       |     - note     |
      |                |                       |     - owner    |

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
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |   data:               |     owner:          |
      |     amount: 30        |       - iota        |
      |                       |   viewFields:       |
      |                       |     - amount        |
      |                       |     - id            |
      |                       |     - owner         |
    Then the read is purged, matching "owner: iota":
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |   owner: iota         |     owner:     |
      |   - owner     |   amount: 30          |       - iota   |
      |   - amount    |                       |   viewFields:  |
      | filter:       |                       |     - amount   |
      |   owner: iota |                       |     - id       |
      |   amount:     |                       |     - owner    |
      |     _gt: 5    |                       |                |
    And the witness reads are still cached, not reading "amount":
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |                       |     owner:     |
      |   - owner     |                       |       - iota   |
      | filter:       |                       |   viewFields:  |
      |   owner: iota |                       |     - id       |
      |               |                       |     - owner    |

  Scenario: a row moving out of the range and owner a read was filtered on purges it
    Given the slots:
      | marker      | owner | method | note  | amount |
      | target_slot | eta   | spaced | first | 10     |
      | other_owner | chi   | spaced | third | 10     |
    And this read is cached:
      | query        | response              | fingerprints   |
      | fields:      | - marker: target_slot | - pinnedScope: |+
      |   - id       |   owner: eta          |     owner:     |
      |   - owner    |   amount: 10          |       - eta    |
      |   - amount   |                       |   viewFields:  |
      | filter:      |                       |     - amount   |
      |   owner: eta |                       |     - id       |
      |   amount:    |                       |     - owner    |
      |     _gte: 5  |                       |                |
      |     _lt: 20  |                       |                |
    And the witness reads are cached:
      | query        | response              | fingerprints   |
      | fields:      | []                    | - pinnedScope: |+
      |   - id       |                       |     owner:     |
      |   - owner    |                       |       - tau    |
      | filter:      |                       |   viewFields:  |
      |   owner: tau |                       |     - id       |
      |              |                       |     - owner    |
      | fields:      | - marker: other_owner | - pinnedScope: |+
      |   - id       |                       |     owner:     |
      |   - owner    |                       |       - chi    |
      | filter:      |                       |   viewFields:  |
      |   owner: chi |                       |     - id       |
      |              |                       |     - owner    |
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |   data:               |     owner:          |
      |     owner: tau        |       - eta         |
      |     amount: 30        |   viewFields:       |
      |                       |     - amount        |
      |                       |     - id            |
      |                       |     - owner         |
      |                       | - pinnedScope:      |
      |                       |     owner:          |
      |                       |       - tau         |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - owner         |
    Then the read is purged, matching "owner: eta" on the row as it was:
      | query        | response | fingerprints   |
      | fields:      | []       | - pinnedScope: |+
      |   - id       |          |     owner:     |
      |   - owner    |          |       - eta    |
      |   - amount   |          |   viewFields:  |
      | filter:      |          |     - amount   |
      |   owner: eta |          |     - id       |
      |   amount:    |          |     - owner    |
      |     _gte: 5  |          |                |
      |     _lt: 20  |          |                |
    And the witness reads are purged, matching "owner: tau":
      | query        | response              | fingerprints   |
      | fields:      | - marker: target_slot | - pinnedScope: |+
      |   - id       |                       |     owner:     |
      |   - owner    |                       |       - tau    |
      | filter:      |                       |   viewFields:  |
      |   owner: tau |                       |     - id       |
      |              |                       |     - owner    |
    And the witness reads are still cached, not matching "owner: chi":
      | query        | response              | fingerprints   |
      | fields:      | - marker: other_owner | - pinnedScope: |+
      |   - id       |                       |     owner:     |
      |   - owner    |                       |       - chi    |
      | filter:      |                       |   viewFields:  |
      |   owner: chi |                       |     - id       |
      |              |                       |     - owner    |

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
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     owner:          |
      |     owner: lambda      |       - kappa       |
      |     method: spaced     |       - lambda      |
      |     note: second       |   viewFields:       |
      |     amount: 20         |     - id            |
      |                        |     - owner         |
    Then the read is purged, matching "owner: lambda":
      | query          | response               | fingerprints   |
      | fields:        | - marker: target_slot  | - pinnedScope: |+
      |   - id         |   owner: kappa         |     owner:     |
      |   - owner      | - marker: created_slot |       - kappa  |
      | filter:        |   owner: lambda        |       - lambda |
      |   owner:       |                        |   viewFields:  |
      |     _in:       |                        |     - id       |
      |       - kappa  |                        |     - owner    |
      |       - lambda |                        |                |
    And the witness reads are still cached, not matching "owner: kappa":
      | query         | response              | fingerprints   |
      | fields:       | - marker: target_slot | - pinnedScope: |+
      |   - id        |                       |     owner:     |
      |   - owner     |                       |       - kappa  |
      | filter:       |                       |   viewFields:  |
      |   owner:      |                       |     - id       |
      |     _in:      |                       |     - owner    |
      |       - kappa |                       |                |

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
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     owner:          |
      |     owner: xi          |       - mu          |
      |     method: spaced     |       - xi          |
      |     note: second       |   viewFields:       |
      |     amount: 20         |     - id            |
      |                        |     - owner         |
    Then the read is still cached, not matching "owner: mu or nu":
      | query      | response              | fingerprints   |
      | fields:    | - marker: target_slot | - pinnedScope: |+
      |   - id     |   owner: mu           |     owner:     |
      |   - owner  |                       |       - mu     |
      | filter:    |                       |       - nu     |
      |   owner:   |                       |   viewFields:  |
      |     _in:   |                       |     - id       |
      |       - mu |                       |     - owner    |
      |       - nu |                       |                |
    And the witness reads are purged, matching "owner: xi":
      | query      | response               | fingerprints   |
      | fields:    | - marker: target_slot  | - pinnedScope: |+
      |   - id     | - marker: created_slot |     owner:     |
      |   - owner  |                        |       - mu     |
      | filter:    |                        |       - xi     |
      |   owner:   |                        |   viewFields:  |
      |     _in:   |                        |     - id       |
      |       - mu |                        |     - owner    |
      |       - xi |                        |                |

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
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: other_owner | - pinnedScope:      |+
      |   data:               |     method:         |
      |     owner: omicron    |       - spaced      |
      |                       |     owner:          |
      |                       |       - omicron     |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - method        |
      |                       |     - owner         |
      |                       | - pinnedScope:      |
      |                       |     method:         |
      |                       |       - spaced      |
      |                       |     owner:          |
      |                       |       - pi          |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - method        |
      |                       |     - owner         |
    Then the read is purged, matching "method: spaced, owner: omicron":
      | query            | response              | fingerprints    |
      | fields:          | - marker: target_slot | - pinnedScope:  |+
      |   - id           |   owner: omicron      |     method:     |
      |   - owner        | - marker: other_owner |       - spaced  |
      | filter:          |   owner: omicron      |     owner:      |
      |   owner: omicron |                       |       - omicron |
      |   method: spaced |                       |   viewFields:   |
      |                  |                       |     - id        |
      |                  |                       |     - method    |
      |                  |                       |     - owner     |
    And the witness reads are purged, matching "method: spaced, owner: pi":
      | query            | response | fingerprints   |
      | fields:          | []       | - pinnedScope: |+
      |   - id           |          |     method:    |
      |   - owner        |          |       - spaced |
      | filter:          |          |     owner:     |
      |   owner: pi      |          |       - pi     |
      |   method: spaced |          |   viewFields:  |
      |                  |          |     - id       |
      |                  |          |     - method   |
      |                  |          |     - owner    |
    And the witness reads are still cached, not matching "method: slow":
      | query            | response               | fingerprints    |
      | fields:          | - marker: other_method | - pinnedScope:  |+
      |   - id           |                        |     method:     |
      |   - owner        |                        |       - slow    |
      | filter:          |                        |     owner:      |
      |   owner: omicron |                        |       - omicron |
      |   method: slow   |                        |   viewFields:   |
      |                  |                        |     - id        |
      |                  |                        |     - method    |
      |                  |                        |     - owner     |

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
    When the slots are updated:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |   data:               |     method:         |
      |     owner: sigma      |       - spaced      |
      |                       |     owner:          |
      |                       |       - rho         |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - method        |
      |                       |     - owner         |
      |                       | - pinnedScope:      |
      |                       |     method:         |
      |                       |       - spaced      |
      |                       |     owner:          |
      |                       |       - sigma       |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - method        |
      |                       |     - owner         |
    Then the read is purged, matching "method: spaced, owner: rho":
      | query            | response | fingerprints   |
      | fields:          | []       | - pinnedScope: |+
      |   - id           |          |     method:    |
      |   - owner        |          |       - spaced |
      | filter:          |          |     owner:     |
      |   owner: rho     |          |       - rho    |
      |   method: spaced |          |   viewFields:  |
      |                  |          |     - id       |
      |                  |          |     - method   |
      |                  |          |     - owner    |
    And the witness reads are purged, matching "method: spaced, owner: sigma":
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |                       |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: sigma   |                       |       - sigma  |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    And the witness reads are still cached, not matching "method: slow":
      | query          | response               | fingerprints   |
      | fields:        | - marker: other_method | - pinnedScope: |+
      |   - id         |                        |     method:    |
      |   - owner      |                        |       - slow   |
      | filter:        |                        |     owner:     |
      |   owner: rho   |                        |       - rho    |
      |   method: slow |                        |   viewFields:  |
      |                |                        |     - id       |
      |                |                        |     - method   |
      |                |                        |     - owner    |

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
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     method:         |
      |     owner: phi         |       - spaced      |
      |     method: spaced     |   viewFields:       |
      |     note: second       |     - id            |
      |     amount: 20         |     - method        |
      |                        |     - owner         |
    Then the read is purged, matching "method: spaced":
      | query                | response               | fingerprints   |
      | fields:              | - marker: target_slot  | - pinnedScope: |+
      |   - id               |   owner: tau           |     owner:     |
      |   - owner            |   method: slow         |       - tau    |
      |   - method           | - marker: created_slot |   viewFields:  |
      | filter:              |   owner: phi           |     - id       |
      |   _or:               |   method: spaced       |     - method   |
      |     - owner: tau     |                        |     - owner    |
      |     - method: spaced |                        | - pinnedScope: |
      |                      |                        |     method:    |
      |                      |                        |       - spaced |
      |                      |                        |   viewFields:  |
      |                      |                        |     - id       |
      |                      |                        |     - method   |
      |                      |                        |     - owner    |
    And the witness reads are still cached, not matching "owner: tau":
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

  Scenario: a read matching two ways is purged by a write matching only its first
    Given the slots:
      | marker      | owner | method | note   | amount |
      | target_slot | sampi | slow   | first  | 10     |
      | other_owner | san   | slow   | second | 20     |
    And this read is cached:
      | query                | response              | fingerprints   |
      | fields:              | - marker: target_slot | - pinnedScope: |+
      |   - id               |   owner: sampi        |     owner:     |
      |   - owner            |   method: slow        |       - sampi  |
      |   - method           |                       |   viewFields:  |
      | filter:              |                       |     - id       |
      |   _or:               |                       |     - method   |
      |     - owner: sampi   |                       |     - owner    |
      |     - method: spaced |                       | - pinnedScope: |
      |                      |                       |     method:    |
      |                      |                       |       - spaced |
      |                      |                       |   viewFields:  |
      |                      |                       |     - id       |
      |                      |                       |     - method   |
      |                      |                       |     - owner    |
    And the witness reads are cached:
      | query                | response              | fingerprints   |
      | fields:              | - marker: other_owner | - pinnedScope: |+
      |   - id               |   owner: san          |     owner:     |
      |   - owner            |   method: slow        |       - san    |
      |   - method           |                       |   viewFields:  |
      | filter:              |                       |     - id       |
      |   _or:               |                       |     - method   |
      |     - owner: san     |                       |     - owner    |
      |     - method: spaced |                       | - pinnedScope: |
      |                      |                       |     method:    |
      |                      |                       |       - spaced |
      |                      |                       |   viewFields:  |
      |                      |                       |     - id       |
      |                      |                       |     - method   |
      |                      |                       |     - owner    |
    When the slots are created:
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     owner:          |
      |     owner: sampi       |       - sampi       |
      |     method: massed     |   viewFields:       |
      |     note: third        |     - id            |
      |     amount: 30         |     - method        |
      |                        |     - owner         |
    Then the read is purged, matching "owner: sampi":
      | query                | response               | fingerprints   |
      | fields:              | - marker: target_slot  | - pinnedScope: |+
      |   - id               |   owner: sampi         |     owner:     |
      |   - owner            |   method: slow         |       - sampi  |
      |   - method           | - marker: created_slot |   viewFields:  |
      | filter:              |   owner: sampi         |     - id       |
      |   _or:               |   method: massed       |     - method   |
      |     - owner: sampi   |                        |     - owner    |
      |     - method: spaced |                        | - pinnedScope: |
      |                      |                        |     method:    |
      |                      |                        |       - spaced |
      |                      |                        |   viewFields:  |
      |                      |                        |     - id       |
      |                      |                        |     - method   |
      |                      |                        |     - owner    |
    And the witness reads are still cached, not matching "owner: san":
      | query                | response              | fingerprints   |
      | fields:              | - marker: other_owner | - pinnedScope: |+
      |   - id               |   owner: san          |     owner:     |
      |   - owner            |   method: slow        |       - san    |
      |   - method           |                       |   viewFields:  |
      | filter:              |                       |     - id       |
      |   _or:               |                       |     - method   |
      |     - owner: san     |                       |     - owner    |
      |     - method: spaced |                       | - pinnedScope: |
      |                      |                       |     method:    |
      |                      |                       |       - spaced |
      |                      |                       |   viewFields:  |
      |                      |                       |     - id       |
      |                      |                       |     - method   |
      |                      |                       |     - owner    |

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
      | query                  | purged fingerprints |
      | - marker: created_slot | - pinnedScope:      |+
      |   data:                |     method:         |
      |     owner: koppa       |       - slow        |
      |     method: slow       |   viewFields:       |
      |     note: second       |     - id            |
      |     amount: 20         |     - method        |
      |                        |     - owner         |
    Then the read is still cached, not matching "owner: omega":
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
    And the witness reads are purged, matching "method: slow":
      | query              | response               | fingerprints   |
      | fields:            | - marker: target_slot  | - pinnedScope: |+
      |   - id             |   owner: omega         |     owner:     |
      |   - owner          |   method: slow         |       - omega  |
      |   - method         | - marker: created_slot |   viewFields:  |
      | filter:            |   owner: koppa         |     - id       |
      |   _or:             |   method: slow         |     - method   |
      |     - owner: omega |                        |     - owner    |
      |     - method: slow |                        | - pinnedScope: |
      |                    |                        |     method:    |
      |                    |                        |       - slow   |
      |                    |                        |   viewFields:  |
      |                    |                        |     - id       |
      |                    |                        |     - method   |
      |                    |                        |     - owner    |

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
    When the slots are deleted:
      | query                 | purged fingerprints |
      | - marker: target_slot | - pinnedScope:      |+
      |                       |     method:         |
      |                       |       - spaced      |
      |                       |     owner:          |
      |                       |       - upsilon     |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - method        |
      |                       |     - owner         |
    Then the read is purged, matching "method: spaced, owner: upsilon":
      | query            | response | fingerprints    |
      | fields:          | []       | - pinnedScope:  |+
      |   - id           |          |     method:     |
      |   - owner        |          |       - spaced  |
      | filter:          |          |     owner:      |
      |   owner: upsilon |          |       - upsilon |
      |   method: spaced |          |   viewFields:   |
      |                  |          |     - id        |
      |                  |          |     - method    |
      |                  |          |     - owner     |
    And the witness reads are still cached, not matching "method: slow":
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
    When the slots are deleted:
      | query                 | purged fingerprints |
      | - marker: other_owner | - pinnedScope:      |+
      |                       |     method:         |
      |                       |       - spaced      |
      |                       |     owner:          |
      |                       |       - psi         |
      |                       |   viewFields:       |
      |                       |     - id            |
      |                       |     - method        |
      |                       |     - owner         |
    Then the read is still cached, not matching "owner: chi":
      | query            | response              | fingerprints   |
      | fields:          | - marker: target_slot | - pinnedScope: |+
      |   - id           |   owner: chi          |     method:    |
      |   - owner        |                       |       - spaced |
      | filter:          |                       |     owner:     |
      |   owner: chi     |                       |       - chi    |
      |   method: spaced |                       |   viewFields:  |
      |                  |                       |     - id       |
      |                  |                       |     - method   |
      |                  |                       |     - owner    |
    And the witness reads are purged, matching "method: spaced, owner: psi":
      | query            | response | fingerprints   |
      | fields:          | []       | - pinnedScope: |+
      |   - id           |          |     method:    |
      |   - owner        |          |       - spaced |
      | filter:          |          |     owner:     |
      |   owner: psi     |          |       - psi    |
      |   method: spaced |          |   viewFields:  |
      |                  |          |     - id       |
      |                  |          |     - method   |
      |                  |          |     - owner    |

  Scenario: a write by another owner leaves a read pinned through a relation cached
    Given the method ranges:
      | marker       | method |
      | spaced_range | spaced |
      | slow_range   | slow   |
    And the slots:
      | marker      | owner | method_range | note   |
      | target_slot | alpha | spaced_range | first  |
      | other_owner | beta  | spaced_range | third  |
      | other_range | beta  | slow_range   | fourth |
    And this read is cached:
      | query              | response              | fingerprints             |
      | fields:            | - marker: target_slot | - pinnedScope:           |+
      |   - id             |   owner: alpha        |     method_range.method: |
      |   - owner          |                       |       - spaced           |
      | filter:            |                       |     owner:               |
      |   owner: alpha     |                       |       - alpha            |
      |   method_range:    |                       |   viewFields:            |
      |     method: spaced |                       |     - id                 |
      |                    |                       |     - method_range       |
      |                    |                       |     - owner              |
    And the witness reads are cached:
      | query              | response              | fingerprints             |
      | fields:            | - marker: other_owner | - pinnedScope:           |+
      |   - id             |                       |     method_range.method: |
      |   - owner          |                       |       - spaced           |
      | filter:            |                       |     owner:               |
      |   owner: beta      |                       |       - beta             |
      |   method_range:    |                       |   viewFields:            |
      |     method: spaced |                       |     - id                 |
      |                    |                       |     - method_range       |
      |                    |                       |     - owner              |
      | fields:            | - marker: other_range | - pinnedScope:           |+
      |   - id             |                       |     method_range.method: |
      |   - owner          |                       |       - slow             |
      | filter:            |                       |     owner:               |
      |   owner: beta      |                       |       - beta             |
      |   method_range:    |                       |   viewFields:            |
      |     method: slow   |                       |     - id                 |
      |                    |                       |     - method_range       |
      |                    |                       |     - owner              |
    When the slots are created:
      | query                          | purged fingerprints      |
      | - marker: created_slot         | - pinnedScope:           |+
      |   data:                        |     method_range.method: |
      |     owner: beta                |       - spaced           |
      |     method_range: spaced_range |     owner:               |
      |     note: second               |       - beta             |
      |                                |   viewFields:            |
      |                                |     - id                 |
      |                                |     - method_range       |
      |                                |     - owner              |
    Then the read is still cached, not matching "owner: alpha":
      | query              | response              | fingerprints             |
      | fields:            | - marker: target_slot | - pinnedScope:           |+
      |   - id             |   owner: alpha        |     method_range.method: |
      |   - owner          |                       |       - spaced           |
      | filter:            |                       |     owner:               |
      |   owner: alpha     |                       |       - alpha            |
      |   method_range:    |                       |   viewFields:            |
      |     method: spaced |                       |     - id                 |
      |                    |                       |     - method_range       |
      |                    |                       |     - owner              |
    And the witness reads are purged, matching "method_range.method: spaced, owner: beta":
      | query              | response               | fingerprints             |
      | fields:            | - marker: other_owner  | - pinnedScope:           |+
      |   - id             | - marker: created_slot |     method_range.method: |
      |   - owner          |                        |       - spaced           |
      | filter:            |                        |     owner:               |
      |   owner: beta      |                        |       - beta             |
      |   method_range:    |                        |   viewFields:            |
      |     method: spaced |                        |     - id                 |
      |                    |                        |     - method_range       |
      |                    |                        |     - owner              |
    And the witness reads are still cached, not matching "method_range.method: slow":
      | query            | response              | fingerprints             |
      | fields:          | - marker: other_range | - pinnedScope:           |+
      |   - id           |                       |     method_range.method: |
      |   - owner        |                       |       - slow             |
      | filter:          |                       |     owner:               |
      |   owner: beta    |                       |       - beta             |
      |   method_range:  |                       |   viewFields:            |
      |     method: slow |                       |     - id                 |
      |                  |                       |     - method_range       |
      |                  |                       |     - owner              |

  Scenario: a write by another owner leaves a composed-path read cached
    Given the course part collection:
      | field | type   | scoped_cache_field |
      | owner | string | yes                |
    And the method range collection:
      | field  | type   | scoped_cache_field |
      | method | string | yes                |
    And the composed slot collection:
      | field        | type    | scoped_cache_field |
      | course_part  | integer | yes                |
      | method_range | integer | yes                |
      | note         | string  | no                 |
    And the course parts:
      | marker     | owner |
      | alpha_part | alpha |
      | beta_part  | beta  |
    And the method ranges:
      | marker       | method |
      | spaced_range | spaced |
      | slow_range   | slow   |
    And the slots:
      | marker      | course_part | method_range | note   |
      | target_slot | alpha_part  | spaced_range | first  |
      | other_owner | beta_part   | spaced_range | third  |
      | other_range | beta_part   | slow_range   | fourth |
    And this read is cached:
      | query              | response              | fingerprints                       |
      | fields:            | - marker: target_slot | - collection: composite_path_slot  |+
      |   - id             |                       |   pinnedScope:                     |
      | filter:            |                       |     course_part.owner:             |
      |   course_part:     |                       |       - alpha                      |
      |     owner: alpha   |                       |     method_range.method:           |
      |   method_range:    |                       |       - spaced                     |
      |     method: spaced |                       |   viewFields:                      |
      |                    |                       |     - course_part                  |
      |                    |                       |     - id                           |
      |                    |                       |     - method_range                 |
      |                    |                       | - collection: composite_path_part  |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     owner:                         |
      |                    |                       |       - alpha                      |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - owner                        |
      |                    |                       | - collection: composite_path_range |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     method:                        |
      |                    |                       |       - spaced                     |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - method                       |
    And the witness reads are cached:
      | query              | response              | fingerprints                       |
      | fields:            | - marker: other_owner | - collection: composite_path_slot  |+
      |   - id             |                       |   pinnedScope:                     |
      | filter:            |                       |     course_part.owner:             |
      |   course_part:     |                       |       - beta                       |
      |     owner: beta    |                       |     method_range.method:           |
      |   method_range:    |                       |       - spaced                     |
      |     method: spaced |                       |   viewFields:                      |
      |                    |                       |     - course_part                  |
      |                    |                       |     - id                           |
      |                    |                       |     - method_range                 |
      |                    |                       | - collection: composite_path_part  |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     owner:                         |
      |                    |                       |       - beta                       |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - owner                        |
      |                    |                       | - collection: composite_path_range |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     method:                        |
      |                    |                       |       - spaced                     |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - method                       |
      | fields:            | - marker: other_range | - collection: composite_path_slot  |+
      |   - id             |                       |   pinnedScope:                     |
      | filter:            |                       |     course_part.owner:             |
      |   course_part:     |                       |       - beta                       |
      |     owner: beta    |                       |     method_range.method:           |
      |   method_range:    |                       |       - slow                       |
      |     method: slow   |                       |   viewFields:                      |
      |                    |                       |     - course_part                  |
      |                    |                       |     - id                           |
      |                    |                       |     - method_range                 |
      |                    |                       | - collection: composite_path_part  |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     owner:                         |
      |                    |                       |       - beta                       |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - owner                        |
      |                    |                       | - collection: composite_path_range |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     method:                        |
      |                    |                       |       - slow                       |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - method                       |
    When the slots are created:
      | query                          | purged fingerprints               |
      | - marker: created_slot         | - collection: composite_path_slot |+
      |   data:                        |   pinnedScope:                    |
      |     course_part: beta_part     |     course_part.owner:            |
      |     method_range: spaced_range |       - beta                      |
      |     note: second               |     method_range.method:          |
      |                                |       - spaced                    |
      |                                |   viewFields:                     |
      |                                |     - course_part                 |
      |                                |     - id                          |
      |                                |     - method_range                |
    Then the read is still cached, not matching "course_part.owner: alpha":
      | query              | response              | fingerprints                       |
      | fields:            | - marker: target_slot | - collection: composite_path_slot  |+
      |   - id             |                       |   pinnedScope:                     |
      | filter:            |                       |     course_part.owner:             |
      |   course_part:     |                       |       - alpha                      |
      |     owner: alpha   |                       |     method_range.method:           |
      |   method_range:    |                       |       - spaced                     |
      |     method: spaced |                       |   viewFields:                      |
      |                    |                       |     - course_part                  |
      |                    |                       |     - id                           |
      |                    |                       |     - method_range                 |
      |                    |                       | - collection: composite_path_part  |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     owner:                         |
      |                    |                       |       - alpha                      |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - owner                        |
      |                    |                       | - collection: composite_path_range |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     method:                        |
      |                    |                       |       - spaced                     |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - method                       |
    And the witness reads are purged, matching "course_part.owner: beta, method_range.method: spaced":
      | query              | response               | fingerprints                       |
      | fields:            | - marker: other_owner  | - collection: composite_path_slot  |+
      |   - id             | - marker: created_slot |   pinnedScope:                     |
      | filter:            |                        |     course_part.owner:             |
      |   course_part:     |                        |       - beta                       |
      |     owner: beta    |                        |     method_range.method:           |
      |   method_range:    |                        |       - spaced                     |
      |     method: spaced |                        |   viewFields:                      |
      |                    |                        |     - course_part                  |
      |                    |                        |     - id                           |
      |                    |                        |     - method_range                 |
      |                    |                        | - collection: composite_path_part  |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     owner:                         |
      |                    |                        |       - beta                       |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - owner                        |
      |                    |                        | - collection: composite_path_range |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     method:                        |
      |                    |                        |       - spaced                     |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - method                       |
    And the witness reads are still cached, not matching "method_range.method: slow":
      | query            | response              | fingerprints                       |
      | fields:          | - marker: other_range | - collection: composite_path_slot  |+
      |   - id           |                       |   pinnedScope:                     |
      | filter:          |                       |     course_part.owner:             |
      |   course_part:   |                       |       - beta                       |
      |     owner: beta  |                       |     method_range.method:           |
      |   method_range:  |                       |       - slow                       |
      |     method: slow |                       |   viewFields:                      |
      |                  |                       |     - course_part                  |
      |                  |                       |     - id                           |
      |                  |                       |     - method_range                 |
      |                  |                       | - collection: composite_path_part  |
      |                  |                       |   pinnedScope:                     |
      |                  |                       |     owner:                         |
      |                  |                       |       - beta                       |
      |                  |                       |   viewFields:                      |
      |                  |                       |     - owner                        |
      |                  |                       | - collection: composite_path_range |
      |                  |                       |   pinnedScope:                     |
      |                  |                       |     method:                        |
      |                  |                       |       - slow                       |
      |                  |                       |   viewFields:                      |
      |                  |                       |     - method                       |

  Scenario: a write by another owner leaves a read selecting through composed paths cached
    Given the course part collection:
      | field | type   | scoped_cache_field |
      | owner | string | yes                |
    And the method range collection:
      | field  | type   | scoped_cache_field |
      | method | string | yes                |
    And the composed slot collection:
      | field        | type    | scoped_cache_field |
      | course_part  | integer | yes                |
      | method_range | integer | yes                |
      | note         | string  | no                 |
    And the course parts:
      | marker     | owner |
      | alpha_part | alpha |
      | beta_part  | beta  |
    And the method ranges:
      | marker       | method |
      | spaced_range | spaced |
      | slow_range   | slow   |
    And the slots:
      | marker      | course_part | method_range | note   |
      | target_slot | alpha_part  | spaced_range | first  |
      | other_owner | beta_part   | spaced_range | third  |
      | other_range | beta_part   | slow_range   | fourth |
    And this read is cached:
      | query                   | response              | fingerprints                       |
      | fields:                 | - marker: target_slot | - collection: composite_path_slot  |+
      |   - id                  |   course_part:        |   pinnedScope:                     |
      |   - course_part.owner   |     owner: alpha      |     course_part.owner:             |
      |   - method_range.method |   method_range:       |       - alpha                      |
      | filter:                 |     method: spaced    |     method_range.method:           |
      |   course_part:          |                       |       - spaced                     |
      |     owner: alpha        |                       |   viewFields:                      |
      |   method_range:         |                       |     - course_part                  |
      |     method: spaced      |                       |     - id                           |
      |                         |                       |     - method_range                 |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     owner:                         |
      |                         |                       |       - alpha                      |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - alpha_part                 |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     method:                        |
      |                         |                       |       - spaced                     |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - spaced_range               |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
    And the witness reads are cached:
      | query                   | response              | fingerprints                       |
      | fields:                 | - marker: other_owner | - collection: composite_path_slot  |+
      |   - id                  |   course_part:        |   pinnedScope:                     |
      |   - course_part.owner   |     owner: beta       |     course_part.owner:             |
      |   - method_range.method |   method_range:       |       - beta                       |
      | filter:                 |     method: spaced    |     method_range.method:           |
      |   course_part:          |                       |       - spaced                     |
      |     owner: beta         |                       |   viewFields:                      |
      |   method_range:         |                       |     - course_part                  |
      |     method: spaced      |                       |     - id                           |
      |                         |                       |     - method_range                 |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     owner:                         |
      |                         |                       |       - beta                       |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - beta_part                  |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     method:                        |
      |                         |                       |       - spaced                     |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - spaced_range               |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      | fields:                 | - marker: other_range | - collection: composite_path_slot  |+
      |   - id                  |   course_part:        |   pinnedScope:                     |
      |   - course_part.owner   |     owner: beta       |     course_part.owner:             |
      |   - method_range.method |   method_range:       |       - beta                       |
      | filter:                 |     method: slow      |     method_range.method:           |
      |   course_part:          |                       |       - slow                       |
      |     owner: beta         |                       |   viewFields:                      |
      |   method_range:         |                       |     - course_part                  |
      |     method: slow        |                       |     - id                           |
      |                         |                       |     - method_range                 |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     owner:                         |
      |                         |                       |       - beta                       |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - beta_part                  |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     method:                        |
      |                         |                       |       - slow                       |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - slow_range                 |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
    When the slots are created:
      | query                          | purged fingerprints               |
      | - marker: created_slot         | - collection: composite_path_slot |+
      |   data:                        |   pinnedScope:                    |
      |     course_part: beta_part     |     course_part.owner:            |
      |     method_range: spaced_range |       - beta                      |
      |     note: second               |     method_range.method:          |
      |                                |       - spaced                    |
      |                                |   viewFields:                     |
      |                                |     - course_part                 |
      |                                |     - id                          |
      |                                |     - method_range                |
    Then the read is still cached, not matching "course_part.owner: alpha":
      | query                   | response              | fingerprints                       |
      | fields:                 | - marker: target_slot | - collection: composite_path_slot  |+
      |   - id                  |   course_part:        |   pinnedScope:                     |
      |   - course_part.owner   |     owner: alpha      |     course_part.owner:             |
      |   - method_range.method |   method_range:       |       - alpha                      |
      | filter:                 |     method: spaced    |     method_range.method:           |
      |   course_part:          |                       |       - spaced                     |
      |     owner: alpha        |                       |   viewFields:                      |
      |   method_range:         |                       |     - course_part                  |
      |     method: spaced      |                       |     - id                           |
      |                         |                       |     - method_range                 |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     owner:                         |
      |                         |                       |       - alpha                      |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - alpha_part                 |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     method:                        |
      |                         |                       |       - spaced                     |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - spaced_range               |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
    And the witness reads are purged, matching "course_part.owner: beta, method_range.method: spaced":
      | query                   | response               | fingerprints                       |
      | fields:                 | - marker: other_owner  | - collection: composite_path_slot  |+
      |   - id                  |   course_part:         |   pinnedScope:                     |
      |   - course_part.owner   |     owner: beta        |     course_part.owner:             |
      |   - method_range.method |   method_range:        |       - beta                       |
      | filter:                 |     method: spaced     |     method_range.method:           |
      |   course_part:          | - marker: created_slot |       - spaced                     |
      |     owner: beta         |   course_part:         |   viewFields:                      |
      |   method_range:         |     owner: beta        |     - course_part                  |
      |     method: spaced      |   method_range:        |     - id                           |
      |                         |     method: spaced     |     - method_range                 |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     owner:                         |
      |                         |                        |       - beta                       |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - beta_part                  |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     method:                        |
      |                         |                        |       - spaced                     |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - spaced_range               |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
    And the witness reads are still cached, not matching "method_range.method: slow":
      | query                   | response              | fingerprints                       |
      | fields:                 | - marker: other_range | - collection: composite_path_slot  |+
      |   - id                  |   course_part:        |   pinnedScope:                     |
      |   - course_part.owner   |     owner: beta       |     course_part.owner:             |
      |   - method_range.method |   method_range:       |       - beta                       |
      | filter:                 |     method: slow      |     method_range.method:           |
      |   course_part:          |                       |       - slow                       |
      |     owner: beta         |                       |   viewFields:                      |
      |   method_range:         |                       |     - course_part                  |
      |     method: slow        |                       |     - id                           |
      |                         |                       |     - method_range                 |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     owner:                         |
      |                         |                       |       - beta                       |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - beta_part                  |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     method:                        |
      |                         |                       |       - slow                       |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - slow_range                 |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |

  Scenario: a write to a parent purges the reads its old and new value match
    Given the course part collection:
      | field | type   | scoped_cache_field |
      | owner | string | yes                |
    And the method range collection:
      | field  | type   | scoped_cache_field |
      | method | string | yes                |
    And the composed slot collection:
      | field        | type    | scoped_cache_field |
      | course_part  | integer | yes                |
      | method_range | integer | yes                |
      | note         | string  | no                 |
    And the course parts:
      | marker     | owner |
      | alpha_part | alpha |
      | beta_part  | beta  |
    And the method ranges:
      | marker       | method |
      | spaced_range | spaced |
      | slow_range   | slow   |
      | massed_range | massed |
    And the slots:
      | marker       | course_part | method_range | note   |
      | target_slot  | alpha_part  | spaced_range | first  |
      | other_range  | beta_part   | slow_range   | second |
      | other_method | alpha_part  | massed_range | third  |
      | other_owner  | beta_part   | spaced_range | fourth |
    And this read is cached:
      | query              | response              | fingerprints                       |
      | fields:            | - marker: target_slot | - collection: composite_path_slot  |+
      |   - id             |                       |   pinnedScope:                     |
      | filter:            |                       |     course_part.owner:             |
      |   course_part:     |                       |       - alpha                      |
      |     owner: alpha   |                       |     method_range.method:           |
      |   method_range:    |                       |       - spaced                     |
      |     method: spaced |                       |   viewFields:                      |
      |                    |                       |     - course_part                  |
      |                    |                       |     - id                           |
      |                    |                       |     - method_range                 |
      |                    |                       | - collection: composite_path_part  |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     owner:                         |
      |                    |                       |       - alpha                      |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - owner                        |
      |                    |                       | - collection: composite_path_range |
      |                    |                       |   pinnedScope:                     |
      |                    |                       |     method:                        |
      |                    |                       |       - spaced                     |
      |                    |                       |   viewFields:                      |
      |                    |                       |     - method                       |
    And the witness reads are cached:
      | query              | response               | fingerprints                       |
      | fields:            | - marker: other_range  | - collection: composite_path_slot  |+
      |   - id             |                        |   pinnedScope:                     |
      | filter:            |                        |     course_part.owner:             |
      |   course_part:     |                        |       - beta                       |
      |     owner: beta    |                        |     method_range.method:           |
      |   method_range:    |                        |       - slow                       |
      |     method: slow   |                        |   viewFields:                      |
      |                    |                        |     - course_part                  |
      |                    |                        |     - id                           |
      |                    |                        |     - method_range                 |
      |                    |                        | - collection: composite_path_part  |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     owner:                         |
      |                    |                        |       - beta                       |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - owner                        |
      |                    |                        | - collection: composite_path_range |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     method:                        |
      |                    |                        |       - slow                       |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - method                       |
      | fields:            | - marker: other_method | - collection: composite_path_slot  |+
      |   - id             |                        |   pinnedScope:                     |
      | filter:            |                        |     course_part.owner:             |
      |   course_part:     |                        |       - alpha                      |
      |     owner: alpha   |                        |     method_range.method:           |
      |   method_range:    |                        |       - massed                     |
      |     method: massed |                        |   viewFields:                      |
      |                    |                        |     - course_part                  |
      |                    |                        |     - id                           |
      |                    |                        |     - method_range                 |
      |                    |                        | - collection: composite_path_part  |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     owner:                         |
      |                    |                        |       - alpha                      |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - owner                        |
      |                    |                        | - collection: composite_path_range |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     method:                        |
      |                    |                        |       - massed                     |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - method                       |
    When the method ranges are updated:
      | query                  | purged fingerprints                |
      | - marker: spaced_range | - collection: composite_path_range |+
      |   data:                |   pinnedScope:                     |
      |     method: slow       |     method:                        |
      |                        |       - spaced                     |
      |                        |   viewFields:                      |
      |                        |     - method                       |
      |                        | - collection: composite_path_range |
      |                        |   pinnedScope:                     |
      |                        |     method:                        |
      |                        |       - slow                       |
      |                        |   viewFields:                      |
      |                        |     - method                       |
    Then the read is purged, matching "method: spaced":
      | query              | response | fingerprints                       |
      | fields:            | []       | - collection: composite_path_slot  |+
      |   - id             |          |   pinnedScope:                     |
      | filter:            |          |     course_part.owner:             |
      |   course_part:     |          |       - alpha                      |
      |     owner: alpha   |          |     method_range.method:           |
      |   method_range:    |          |       - spaced                     |
      |     method: spaced |          |   viewFields:                      |
      |                    |          |     - course_part                  |
      |                    |          |     - id                           |
      |                    |          |     - method_range                 |
      |                    |          | - collection: composite_path_part  |
      |                    |          |   pinnedScope:                     |
      |                    |          |     owner:                         |
      |                    |          |       - alpha                      |
      |                    |          |   viewFields:                      |
      |                    |          |     - owner                        |
      |                    |          | - collection: composite_path_range |
      |                    |          |   pinnedScope:                     |
      |                    |          |     method:                        |
      |                    |          |       - spaced                     |
      |                    |          |   viewFields:                      |
      |                    |          |     - method                       |
    And the witness reads are purged, matching "method: slow":
      | query            | response              | fingerprints                       |
      | fields:          | - marker: other_range | - collection: composite_path_slot  |+
      |   - id           | - marker: other_owner |   pinnedScope:                     |
      | filter:          |                       |     course_part.owner:             |
      |   course_part:   |                       |       - beta                       |
      |     owner: beta  |                       |     method_range.method:           |
      |   method_range:  |                       |       - slow                       |
      |     method: slow |                       |   viewFields:                      |
      |                  |                       |     - course_part                  |
      |                  |                       |     - id                           |
      |                  |                       |     - method_range                 |
      |                  |                       | - collection: composite_path_part  |
      |                  |                       |   pinnedScope:                     |
      |                  |                       |     owner:                         |
      |                  |                       |       - beta                       |
      |                  |                       |   viewFields:                      |
      |                  |                       |     - owner                        |
      |                  |                       | - collection: composite_path_range |
      |                  |                       |   pinnedScope:                     |
      |                  |                       |     method:                        |
      |                  |                       |       - slow                       |
      |                  |                       |   viewFields:                      |
      |                  |                       |     - method                       |
    And the witness reads are still cached, not matching "method: massed":
      | query              | response               | fingerprints                       |
      | fields:            | - marker: other_method | - collection: composite_path_slot  |+
      |   - id             |                        |   pinnedScope:                     |
      | filter:            |                        |     course_part.owner:             |
      |   course_part:     |                        |       - alpha                      |
      |     owner: alpha   |                        |     method_range.method:           |
      |   method_range:    |                        |       - massed                     |
      |     method: massed |                        |   viewFields:                      |
      |                    |                        |     - course_part                  |
      |                    |                        |     - id                           |
      |                    |                        |     - method_range                 |
      |                    |                        | - collection: composite_path_part  |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     owner:                         |
      |                    |                        |       - alpha                      |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - owner                        |
      |                    |                        | - collection: composite_path_range |
      |                    |                        |   pinnedScope:                     |
      |                    |                        |     method:                        |
      |                    |                        |       - massed                     |
      |                    |                        |   viewFields:                      |
      |                    |                        |     - method                       |

  Scenario: a write to a parent purges the reads selecting through it that its old and new value match
    Given the course part collection:
      | field | type   | scoped_cache_field |
      | owner | string | yes                |
    And the method range collection:
      | field  | type   | scoped_cache_field |
      | method | string | yes                |
    And the composed slot collection:
      | field        | type    | scoped_cache_field |
      | course_part  | integer | yes                |
      | method_range | integer | yes                |
      | note         | string  | no                 |
    And the course parts:
      | marker     | owner |
      | alpha_part | alpha |
      | beta_part  | beta  |
    And the method ranges:
      | marker       | method |
      | spaced_range | spaced |
      | slow_range   | slow   |
      | massed_range | massed |
    And the slots:
      | marker       | course_part | method_range | note   |
      | target_slot  | alpha_part  | spaced_range | first  |
      | other_range  | beta_part   | slow_range   | second |
      | other_method | alpha_part  | massed_range | third  |
      | other_owner  | beta_part   | spaced_range | fourth |
    And this read is cached:
      | query                   | response              | fingerprints                       |
      | fields:                 | - marker: target_slot | - collection: composite_path_slot  |+
      |   - id                  |   course_part:        |   pinnedScope:                     |
      |   - course_part.owner   |     owner: alpha      |     course_part.owner:             |
      |   - method_range.method |   method_range:       |       - alpha                      |
      | filter:                 |     method: spaced    |     method_range.method:           |
      |   course_part:          |                       |       - spaced                     |
      |     owner: alpha        |                       |   viewFields:                      |
      |   method_range:         |                       |     - course_part                  |
      |     method: spaced      |                       |     - id                           |
      |                         |                       |     - method_range                 |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     owner:                         |
      |                         |                       |       - alpha                      |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - alpha_part                 |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     method:                        |
      |                         |                       |       - spaced                     |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - spaced_range               |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
    And the witness reads are cached:
      | query                   | response               | fingerprints                       |
      | fields:                 | - marker: other_range  | - collection: composite_path_slot  |+
      |   - id                  |   course_part:         |   pinnedScope:                     |
      |   - course_part.owner   |     owner: beta        |     course_part.owner:             |
      |   - method_range.method |   method_range:        |       - beta                       |
      | filter:                 |     method: slow       |     method_range.method:           |
      |   course_part:          |                        |       - slow                       |
      |     owner: beta         |                        |   viewFields:                      |
      |   method_range:         |                        |     - course_part                  |
      |     method: slow        |                        |     - id                           |
      |                         |                        |     - method_range                 |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     owner:                         |
      |                         |                        |       - beta                       |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - beta_part                  |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     method:                        |
      |                         |                        |       - slow                       |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - slow_range                 |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
      | fields:                 | - marker: other_method | - collection: composite_path_slot  |+
      |   - id                  |   course_part:         |   pinnedScope:                     |
      |   - course_part.owner   |     owner: alpha       |     course_part.owner:             |
      |   - method_range.method |   method_range:        |       - alpha                      |
      | filter:                 |     method: massed     |     method_range.method:           |
      |   course_part:          |                        |       - massed                     |
      |     owner: alpha        |                        |   viewFields:                      |
      |   method_range:         |                        |     - course_part                  |
      |     method: massed      |                        |     - id                           |
      |                         |                        |     - method_range                 |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     owner:                         |
      |                         |                        |       - alpha                      |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - alpha_part                 |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     method:                        |
      |                         |                        |       - massed                     |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - massed_range               |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
    When the method ranges are updated:
      | query                  | purged fingerprints                |
      | - marker: spaced_range | - collection: composite_path_range |+
      |   data:                |   pinnedScope:                     |
      |     method: slow       |     method:                        |
      |                        |       - spaced                     |
      |                        |   viewFields:                      |
      |                        |     - method                       |
      |                        | - collection: composite_path_range |
      |                        |   pinnedScope:                     |
      |                        |     method:                        |
      |                        |       - slow                       |
      |                        |   viewFields:                      |
      |                        |     - method                       |
      |                        | - collection: composite_path_range |
      |                        |   pinnedScope:                     |
      |                        |     id:                            |
      |                        |       - spaced_range               |
      |                        |   viewFields:                      |
      |                        |     - method                       |
    # The part's primary key is left over from the first fill, not filed by the
    # refill, whose answer shows no part: a purge removes only the members it
    # matched, and this write matched none of the part's. Harmless (a wider
    # purge, never a stale read); it goes once a purge drops every member of the
    # entries it drops, https://github.com/jclaveau/directus/issues/547.
    Then the read is purged, matching "method: spaced":
      | query                   | response | fingerprints                       |
      | fields:                 | []       | - collection: composite_path_slot  |+
      |   - id                  |          |   pinnedScope:                     |
      |   - course_part.owner   |          |     course_part.owner:             |
      |   - method_range.method |          |       - alpha                      |
      | filter:                 |          |     method_range.method:           |
      |   course_part:          |          |       - spaced                     |
      |     owner: alpha        |          |   viewFields:                      |
      |   method_range:         |          |     - course_part                  |
      |     method: spaced      |          |     - id                           |
      |                         |          |     - method_range                 |
      |                         |          | - collection: composite_path_part  |
      |                         |          |   pinnedScope:                     |
      |                         |          |     owner:                         |
      |                         |          |       - alpha                      |
      |                         |          |   viewFields:                      |
      |                         |          |     - owner                        |
      |                         |          | - collection: composite_path_part  |
      |                         |          |   pinnedScope:                     |
      |                         |          |     id:                            |
      |                         |          |       - alpha_part                 |
      |                         |          |   viewFields:                      |
      |                         |          |     - owner                        |
      |                         |          | - collection: composite_path_range |
      |                         |          |   pinnedScope:                     |
      |                         |          |     method:                        |
      |                         |          |       - spaced                     |
      |                         |          |   viewFields:                      |
      |                         |          |     - method                       |
    And the witness reads are purged, matching "method: slow":
      | query                   | response              | fingerprints                       |
      | fields:                 | - marker: other_range | - collection: composite_path_slot  |+
      |   - id                  |   course_part:        |   pinnedScope:                     |
      |   - course_part.owner   |     owner: beta       |     course_part.owner:             |
      |   - method_range.method |   method_range:       |       - beta                       |
      | filter:                 |     method: slow      |     method_range.method:           |
      |   course_part:          | - marker: other_owner |       - slow                       |
      |     owner: beta         |   course_part:        |   viewFields:                      |
      |   method_range:         |     owner: beta       |     - course_part                  |
      |     method: slow        |   method_range:       |     - id                           |
      |                         |     method: slow      |     - method_range                 |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     owner:                         |
      |                         |                       |       - beta                       |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_part  |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - beta_part                  |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - owner                        |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     method:                        |
      |                         |                       |       - slow                       |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - slow_range                 |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
      |                         |                       | - collection: composite_path_range |
      |                         |                       |   pinnedScope:                     |
      |                         |                       |     id:                            |
      |                         |                       |       - spaced_range               |
      |                         |                       |   viewFields:                      |
      |                         |                       |     - method                       |
    And the witness reads are still cached, not matching "method: massed":
      | query                   | response               | fingerprints                       |
      | fields:                 | - marker: other_method | - collection: composite_path_slot  |+
      |   - id                  |   course_part:         |   pinnedScope:                     |
      |   - course_part.owner   |     owner: alpha       |     course_part.owner:             |
      |   - method_range.method |   method_range:        |       - alpha                      |
      | filter:                 |     method: massed     |     method_range.method:           |
      |   course_part:          |                        |       - massed                     |
      |     owner: alpha        |                        |   viewFields:                      |
      |   method_range:         |                        |     - course_part                  |
      |     method: massed      |                        |     - id                           |
      |                         |                        |     - method_range                 |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     owner:                         |
      |                         |                        |       - alpha                      |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_part  |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - alpha_part                 |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - owner                        |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     method:                        |
      |                         |                        |       - massed                     |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
      |                         |                        | - collection: composite_path_range |
      |                         |                        |   pinnedScope:                     |
      |                         |                        |     id:                            |
      |                         |                        |       - massed_range               |
      |                         |                        |   viewFields:                      |
      |                         |                        |     - method                       |
