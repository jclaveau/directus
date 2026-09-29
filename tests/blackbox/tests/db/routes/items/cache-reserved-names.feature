Feature: A name carrying a fingerprint separator still purges its own reads

  A fingerprint is rendered as `<collection>:&<field>=,<value>,&...&`, and an
  index member joins it to the cache key it names as `<fingerprint>|<cache key>`.
  Directus accepts a field or a collection named with any of those separators, and
  reading a name back at the wrong one files the read under a fingerprint no row
  ever matches:

  - a field named with `=` was read as the field before its first `=`, so the pin
    named a field no row carries and no write matched it;
  - a collection named with `|` was rendered unescaped, so the member split at the
    `|` inside the name: the purge matched a fingerprint of a collection holding
    no pin and deleted a cache key that does not exist, leaving the entry cached;
  - a value carrying `|` is escaped as `\|`, which still holds the raw character,
    so a member split at its first `|` cut the value in two and the purge deleted
    a cache key that does not exist, leaving the entry cached;
  - a field named `view` shares its name with the pin holding the fields the
    read selected, so the view overwrote the pin and the read was filed bare:
    every write to the collection purged it, whatever value it pinned.

  A read is stated by its `query`, the `response` it answers with, and the
  `fingerprints` it is filed under, read back out of the index; every fingerprint
  names the collection it was filed for. Each collection also carries a `note` no
  read names, so no view covers the whole collection.

  Every scenario caches a witness read pinned on another value, which the write
  never matches, so a purge flushing the whole collection shows up as a witness
  MISS.

  Background:
    Given the collections:
      | collection          | field | type   | scoped_cache_field |
      | reserved_name_field | a=b   | string | yes                |
      | reserved_name_field | note  | string | no                 |
      | reserved_name\|pipe | owner | string | yes                |
      | reserved_name\|pipe | note  | string | no                 |
      | reserved_name_value | owner | string | yes                |
      | reserved_name_value | note  | string | no                 |
      | reserved_name_view  | view  | string | yes                |
      | reserved_name_view  | note  | string | no                 |

  Scenario: a write to a field named with an equals sign purges the read pinned on it
    Given the rows of reserved_name_field:
      | marker    | data                    |
      | red_row   | {a=b: red, note: one}   |
      | green_row | {a=b: green, note: two} |
    And this read of reserved_name_field is cached:
      | query        | response          | fingerprints                     |
      | fields:      | - marker: red_row | - collection: reserved_name_field |+
      |   - id       |   a=b: red        |   pinnedScope:                   |
      |   - a=b      |                   |     a=b:                         |
      | filter:      |                   |       - red                      |
      |   a=b:       |                   |   viewFields:                    |
      |     _eq: red |                   |     - a=b                        |
      |              |                   |     - id                         |
    And the witness reads of reserved_name_field are cached:
      | query          | response            | fingerprints                      |
      | fields:        | - marker: green_row | - collection: reserved_name_field |+
      |   - id         |   a=b: green        |   pinnedScope:                    |
      |   - a=b        |                     |     a=b:                          |
      | filter:        |                     |       - green                     |
      |   a=b:         |                     |   viewFields:                     |
      |     _eq: green |                     |     - a=b                         |
      |                |                     |     - id                          |
    When the reserved_name_field rows are updated:
      | marker  | data        |
      | red_row | {a=b: blue} |
    Then the read is purged, the row held "a=b: red":
      | query        | response |
      | fields:      | []       |+
      |   - id       |          |
      |   - a=b      |          |
      | filter:      |          |
      |   a=b:       |          |
      |     _eq: red |          |
    And the witness reads are still cached, the row never held "a=b: green":
      | query          | response            |
      | fields:        | - marker: green_row |+
      |   - id         |   a=b: green        |
      |   - a=b        |                     |
      | filter:        |                     |
      |   a=b:         |                     |
      |     _eq: green |                     |

  Scenario: a write to a collection named with a pipe purges the read pinned on it
    Given the rows of reserved_name|pipe:
      | marker    | data                     |
      | alpha_row | {owner: alpha, note: one} |
      | beta_row  | {owner: beta, note: two}  |
    And this read of reserved_name|pipe is cached:
      | query          | response            | fingerprints                     |
      | fields:        | - marker: alpha_row | - collection: reserved_name\|pipe |+
      |   - id         |   owner: alpha      |   pinnedScope:                   |
      |   - owner      |                     |     owner:                       |
      | filter:        |                     |       - alpha                    |
      |   owner:       |                     |   viewFields:                    |
      |     _eq: alpha |                     |     - id                         |
      |                |                     |     - owner                      |
    And the witness reads of reserved_name|pipe are cached:
      | query         | response           | fingerprints                      |
      | fields:       | - marker: beta_row | - collection: reserved_name\|pipe |+
      |   - id        |   owner: beta      |   pinnedScope:                    |
      |   - owner     |                    |     owner:                        |
      | filter:       |                    |       - beta                      |
      |   owner:      |                    |   viewFields:                     |
      |     _eq: beta |                    |     - id                          |
      |               |                    |     - owner                       |
    When the reserved_name|pipe rows are updated:
      | marker    | data           |
      | alpha_row | {owner: gamma} |
    Then the read is purged, the row held "owner: alpha":
      | query          | response |
      | fields:        | []       |+
      |   - id         |          |
      |   - owner      |          |
      | filter:        |          |
      |   owner:       |          |
      |     _eq: alpha |          |
    And the witness reads are still cached, the row never held "owner: beta":
      | query         | response           |
      | fields:       | - marker: beta_row |+
      |   - id        |   owner: beta      |
      |   - owner     |                    |
      | filter:       |                    |
      |   owner:      |                    |
      |     _eq: beta |                    |

  Scenario: a write to a row whose value carries a pipe purges the read pinned on it
    Given the rows of reserved_name_value:
      | marker  | data                         |
      | one_row | {owner: red\|one, note: one} |
      | two_row | {owner: red\|two, note: two} |
    And this read of reserved_name_value is cached:
      | query             | response          | fingerprints                      |
      | fields:           | - marker: one_row | - collection: reserved_name_value |+
      |   - id            |   owner: red\|one |   pinnedScope:                    |
      |   - owner         |                   |     owner:                        |
      | filter:           |                   |       - red\|one                  |
      |   owner: red\|one |                   |   viewFields:                     |
      |                   |                   |     - id                          |
      |                   |                   |     - owner                       |
    And the witness reads of reserved_name_value are cached:
      | query             | response          | fingerprints                      |
      | fields:           | - marker: two_row | - collection: reserved_name_value |+
      |   - id            |   owner: red\|two |   pinnedScope:                    |
      |   - owner         |                   |     owner:                        |
      | filter:           |                   |       - red\|two                  |
      |   owner: red\|two |                   |   viewFields:                     |
      |                   |                   |     - id                          |
      |                   |                   |     - owner                       |
    When the reserved_name_value rows are updated:
      | marker  | data           |
      | one_row | {owner: gamma} |
    Then the read is purged, the row held "owner: red|one":
      | query             | response |
      | fields:           | []       |+
      |   - id            |          |
      |   - owner         |          |
      | filter:           |          |
      |   owner: red\|one |          |
    And the witness reads are still cached, the row never held "owner: red|two":
      | query             | response          |
      | fields:           | - marker: two_row |+
      |   - id            |   owner: red\|two |
      |   - owner         |                   |
      | filter:           |                   |
      |   owner: red\|two |                   |

  Scenario: a write to a field named view purges the read pinned on it
    Given the rows of reserved_name_view:
      | marker    | data                     |
      | red_row   | {view: red, note: one}   |
      | green_row | {view: green, note: two} |
    And this read of reserved_name_view is cached:
      | query        | response          | fingerprints                     |
      | fields:      | - marker: red_row | - collection: reserved_name_view |+
      |   - id       |   view: red       |   pinnedScope:                   |
      |   - view     |                   |     view:                        |
      | filter:      |                   |       - red                      |
      |   view:      |                   |   viewFields:                    |
      |     _eq: red |                   |     - id                         |
      |              |                   |     - view                       |
    And the witness reads of reserved_name_view are cached:
      | query          | response            | fingerprints                     |
      | fields:        | - marker: green_row | - collection: reserved_name_view |+
      |   - id         |   view: green       |   pinnedScope:                   |
      |   - view       |                     |     view:                        |
      | filter:        |                     |       - green                    |
      |   view:        |                     |   viewFields:                    |
      |     _eq: green |                     |     - id                         |
      |                |                     |     - view                       |
    When the reserved_name_view rows are updated:
      | marker  | data         |
      | red_row | {view: blue} |
    Then the read is purged, the row held "view: red":
      | query        | response |
      | fields:      | []       |+
      |   - id       |          |
      |   - view     |          |
      | filter:      |          |
      |   view:      |          |
      |     _eq: red |          |
    And the witness reads are still cached, the row never held "view: green":
      | query          | response            |
      | fields:        | - marker: green_row |+
      |   - id         |   view: green       |
      |   - view       |                     |
      | filter:        |                     |
      |   view:        |                     |
      |     _eq: green |                     |
