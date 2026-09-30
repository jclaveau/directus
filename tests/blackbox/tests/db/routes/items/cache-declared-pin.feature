Feature: A purge a hook declares reaches every read its slice could answer

  A hook declares what a mutation touched through `scopedCache.purgeBy`, and the
  declaration is the only way the cache learns of a write the framework never
  saw. Here a signal row's create hook rewrites a slot's note behind the items
  service and declares a fingerprint of the slot collection: nothing else purges
  the slots' reads, so a read still answering the old note after the signal is a
  declaration that missed it.

  A declared value is spelled however the hook holds it. The host types it off
  the column its field names, which for a dotted scope path is the column the
  path ends on, and canonicalizes it the way the read's own pin was: a string
  folds to lower case, so a declared `NORTH` names the slice a read of `north`
  is pinned to.

  A declared value pin reaches the reads that pin nothing as well as the ones
  pinned to its slice. A read filtered on a range, or not filtered at all, is
  filed under a bare fingerprint and holds that slice's rows as much as a read
  pinned to it does.

  A hook written before fingerprints still declares a pin, `{ collection,
  field, value }`, and the pin names the slice its field and value spell: read
  as a fingerprint pinning nothing, it would purge only the reads that do.

  A declaration on another collection reads that collection's index the way its
  fills were filed there: the bare set, the set its value names, and the home pin
  sets a read pinning something else was filed under, never the sets of another
  index value. Which sets were read is taken off Redis `MONITOR`.

  A read and a write are stated the way `cache-composite-tag.feature` states
  them: the `query` a read sends, the `response` it answers and the
  `fingerprints` it is filed under; the rows a signal rewrites, the fingerprints
  it declares, and the `purged fingerprints` it dropped from the index. Every
  fingerprint here is of the slot collection, and carries no `collection`.

  Background:
    Given the slot collection:
      | field  | type    | scoped_cache_field |
      | owner  | string  | yes                |
      | zone   | integer | zone.label         |
      | note   | string  | no                 |
      | amount | integer | no                 |

  Scenario: a purge declared on a dotted path in another case purges the read
    Given the zones:
      | marker     | label |
      | north_zone | north |
      | south_zone | south |
    And the slots:
      | marker      | owner | zone       | note  | amount |
      | target_slot | alpha | north_zone | first | 10     |
      | other_zone  | alpha | south_zone | third | 30     |
    And this read is cached:
      | query          | response              | fingerprints    |
      | fields:        | - marker: target_slot | - pinnedScope:  |+
      |   - id         |   note: first         |     zone.label: |
      |   - note       |                       |       - north   |
      | filter:        |                       |   viewFields:   |
      |   zone:        |                       |     - id        |
      |     label:     |                       |     - note      |
      |       north    |                       |     - zone      |
    And the witness reads are cached:
      | query          | response             | fingerprints    |
      | fields:        | - marker: other_zone | - pinnedScope:  |+
      |   - id         |   note: third        |     zone.label: |
      |   - note       |                      |       - south   |
      | filter:        |                      |   viewFields:   |
      |   zone:        |                      |     - id        |
      |     label:     |                      |     - note      |
      |       south    |                      |     - zone      |
    When the signal rewrites the slots and declares:
      | query                 | declared          | purged fingerprints |
      | - marker: target_slot | - pinnedScope:    | - pinnedScope:      |+
      |   note: rewritten     |     zone.label:   |     zone.label:     |
      |                       |       - NORTH     |       - north       |
      |                       |                   |   viewFields:       |
      |                       |                   |     - id            |
      |                       |                   |     - note          |
      |                       |                   |     - zone          |
    Then the read is purged, "NORTH" typed off "label" matching "north":
      | query          | response              | fingerprints    |
      | fields:        | - marker: target_slot | - pinnedScope:  |+
      |   - id         |   note: rewritten     |     zone.label: |
      |   - note       |                       |       - north   |
      | filter:        |                       |   viewFields:   |
      |   zone:        |                       |     - id        |
      |     label:     |                       |     - note      |
      |       north    |                       |     - zone      |
    And the witness reads are still cached, not matching "zone.label: south":
      | query          | response             | fingerprints    |
      | fields:        | - marker: other_zone | - pinnedScope:  |+
      |   - id         |   note: third        |     zone.label: |
      |   - note       |                      |       - south   |
      | filter:        |                      |   viewFields:   |
      |   zone:        |                      |     - id        |
      |     label:     |                      |     - note      |
      |       south    |                      |     - zone      |

  Scenario: a purge declared on a value purges the reads pinning nothing
    Given the slots:
      | marker      | owner | note  | amount |
      | target_slot | alpha | first | 10     |
      | other_owner | beta  | third | 30     |
    And this read is cached:
      | query      | response              | fingerprints       |
      | fields:    | - marker: target_slot | - pinnedScope: {}  |+
      |   - id     |   note: first         |   viewFields:      |
      |   - note   | - marker: other_owner |     - amount       |
      | filter:    |   note: third         |     - id           |
      |   amount:  |                       |     - note         |
      |     _gt: 5 |                       |                    |
    And the witness reads are cached:
      | query         | response              | fingerprints      |
      | fields:       | - marker: target_slot | - pinnedScope: {} |+
      |   - id        |   note: first         |   viewFields:     |
      |   - note      | - marker: other_owner |     - id          |
      |               |   note: third         |     - note        |
      | fields:       | - marker: other_owner | - pinnedScope:    |+
      |   - id        |   note: third         |     owner:        |
      |   - note      |                       |       - beta      |
      | filter:       |                       |   viewFields:     |
      |   owner: beta |                       |     - id          |
      |               |                       |     - note        |
      |               |                       |     - owner       |
    When the signal rewrites the slots and declares:
      | query                 | declared       | purged fingerprints |
      | - marker: target_slot | - pinnedScope: | - pinnedScope: {}   |+
      |   note: rewritten     |     owner:     |   viewFields:       |
      |                       |       - alpha  |     - amount        |
      |                       |                |     - id            |
      |                       |                |     - note          |
      |                       |                | - pinnedScope: {}   |
      |                       |                |   viewFields:       |
      |                       |                |     - id            |
      |                       |                |     - note          |
    Then the read is purged, a range read pinning nothing holding "owner: alpha":
      | query      | response              | fingerprints      |
      | fields:    | - marker: target_slot | - pinnedScope: {} |+
      |   - id     |   note: rewritten     |   viewFields:     |
      |   - note   | - marker: other_owner |     - amount      |
      | filter:    |   note: third         |     - id          |
      |   amount:  |                       |     - note        |
      |     _gt: 5 |                       |                   |
    And the witness reads are purged, an unfiltered read holding "owner: alpha":
      | query    | response              | fingerprints      |
      | fields:  | - marker: target_slot | - pinnedScope: {} |+
      |   - id   |   note: rewritten     |   viewFields:     |
      |   - note | - marker: other_owner |     - id          |
      |          |   note: third         |     - note        |
    And the witness reads are still cached, not matching "owner: beta":
      | query         | response              | fingerprints   |
      | fields:       | - marker: other_owner | - pinnedScope: |+
      |   - id        |   note: third         |     owner:     |
      |   - note      |                       |       - beta   |
      | filter:       |                       |   viewFields:  |
      |   owner: beta |                       |     - id       |
      |               |                       |     - note     |
      |               |                       |     - owner    |

  Scenario: a purge declared as a pre-fingerprint pin purges the read pinned on it
    Given the slots:
      | marker      | owner | note  | amount |
      | target_slot | alpha | first | 10     |
      | other_owner | beta  | third | 30     |
    And this read is cached:
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |   note: first         |     owner:     |
      |   - note       |                       |       - alpha  |
      | filter:        |                       |   viewFields:  |
      |   owner: alpha |                       |     - id       |
      |                |                       |     - note     |
      |                |                       |     - owner    |
    And the witness reads are cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: other_owner | - pinnedScope: |+
      |   - id        |   note: third         |     owner:     |
      |   - note      |                       |       - beta   |
      | filter:       |                       |   viewFields:  |
      |   owner: beta |                       |     - id       |
      |               |                       |     - note     |
      |               |                       |     - owner    |
    When the signal rewrites the slots and declares:
      | query                 | declared       | purged fingerprints |
      | - marker: target_slot | - field: owner | - pinnedScope:      |+
      |   note: rewritten     |   value: alpha |     owner:          |
      |                       |                |       - alpha       |
      |                       |                |   viewFields:       |
      |                       |                |     - id            |
      |                       |                |     - note          |
      |                       |                |     - owner         |
    Then the read is purged, the pin naming "owner: alpha":
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |   note: rewritten     |     owner:     |
      |   - note       |                       |       - alpha  |
      | filter:        |                       |   viewFields:  |
      |   owner: alpha |                       |     - id       |
      |                |                       |     - note     |
      |                |                       |     - owner    |
    And the witness reads are still cached, not matching "owner: beta":
      | query         | response              | fingerprints   |
      | fields:       | - marker: other_owner | - pinnedScope: |+
      |   - id        |   note: third         |     owner:     |
      |   - note      |                       |       - beta   |
      | filter:       |                       |   viewFields:  |
      |   owner: beta |                       |     - id       |
      |               |                       |     - note     |
      |               |                       |     - owner    |

  Scenario: a purge declared on another collection reads only the sets it names
    Given the slots:
      | marker      | owner | note  | amount |
      | target_slot | alpha | first | 10     |
      | other_owner | beta  | third | 30     |
    And this read is cached:
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |   note: first         |     owner:     |
      |   - note       |                       |       - alpha  |
      | filter:        |                       |   viewFields:  |
      |   owner: alpha |                       |     - id       |
      |                |                       |     - note     |
      |                |                       |     - owner    |
    And the witness reads are cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: other_owner | - pinnedScope: |+
      |   - id        |   note: third         |     owner:     |
      |   - note      |                       |       - beta   |
      | filter:       |                       |   viewFields:  |
      |   owner: beta |                       |     - id       |
      |               |                       |     - note     |
      |               |                       |     - owner    |
    When the signal rewrites the slots and declares:
      | query                 | declared       | purged fingerprints |
      | - marker: target_slot | - pinnedScope: | - pinnedScope:      |+
      |   note: rewritten     |     owner:     |     owner:          |
      |                       |       - alpha  |       - alpha       |
      |                       |                |   viewFields:       |
      |                       |                |     - id            |
      |                       |                |     - note          |
      |                       |                |     - owner         |
    And the declaration read the home pin sets and only the index sets it names:
      | command | index set                     |
      | scan    | declared_pin_slot:pin:*       |
      | sscan   | declared_pin_slot:            |
      | sscan   | declared_pin_slot:owner=alpha |
    Then the read is purged, its own set among the index sets read:
      | query          | response              | fingerprints   |
      | fields:        | - marker: target_slot | - pinnedScope: |+
      |   - id         |   note: rewritten     |     owner:     |
      |   - note       |                       |       - alpha  |
      | filter:        |                       |   viewFields:  |
      |   owner: alpha |                       |     - id       |
      |                |                       |     - note     |
      |                |                       |     - owner    |
    And the witness reads are still cached, not matching "owner: beta":
      | query         | response              | fingerprints   |
      | fields:       | - marker: other_owner | - pinnedScope: |+
      |   - id        |   note: third         |     owner:     |
      |   - note      |                       |       - beta   |
      | filter:       |                       |   viewFields:  |
      |   owner: beta |                       |     - id       |
      |               |                       |     - note     |
      |               |                       |     - owner    |

  Scenario: a purge declared on the index path purges a read filed under a home pin
    Given the zones:
      | marker     | label |
      | north_zone | north |
      | south_zone | south |
    And the slots:
      | marker      | owner | zone       | note  | amount |
      | target_slot | alpha | north_zone | first | 10     |
      | other_owner | beta  | south_zone | third | 30     |
    And this read is cached:
      | query          | response              | fingerprints    |
      | fields:        | - marker: target_slot | - pinnedScope:  |+
      |   - id         |   note: first         |     zone.label: |
      |   - note       |                       |       - north   |
      | filter:        |                       |   viewFields:   |
      |   zone:        |                       |     - id        |
      |     label:     |                       |     - note      |
      |       north    |                       |     - zone      |
    And the witness reads are cached:
      | query         | response              | fingerprints   |
      | fields:       | - marker: other_owner | - pinnedScope: |+
      |   - id        |   note: third         |     owner:     |
      |   - note      |                       |       - beta   |
      | filter:       |                       |   viewFields:  |
      |   owner: beta |                       |     - id       |
      |               |                       |     - note     |
      |               |                       |     - owner    |
    When the signal rewrites the slots and declares:
      | query                 | declared       | purged fingerprints |
      | - marker: target_slot | - pinnedScope: | - pinnedScope:      |+
      |   note: rewritten     |     owner:     |     zone.label:     |
      |                       |       - alpha  |       - north       |
      |                       |                |   viewFields:       |
      |                       |                |     - id            |
      |                       |                |     - note          |
      |                       |                |     - zone          |
    Then the read is purged, filed under "pin:zone.label=north" and pinning no owner:
      | query          | response              | fingerprints    |
      | fields:        | - marker: target_slot | - pinnedScope:  |+
      |   - id         |   note: rewritten     |     zone.label: |
      |   - note       |                       |       - north   |
      | filter:        |                       |   viewFields:   |
      |   zone:        |                       |     - id        |
      |     label:     |                       |     - note      |
      |       north    |                       |     - zone      |
    And the witness reads are still cached, not matching "owner: beta":
      | query         | response              | fingerprints   |
      | fields:       | - marker: other_owner | - pinnedScope: |+
      |   - id        |   note: third         |     owner:     |
      |   - note      |                       |       - beta   |
      | filter:       |                       |   viewFields:  |
      |   owner: beta |                       |     - id       |
      |               |                       |     - note     |
      |               |                       |     - owner    |
