Feature: An older build's write still reaches the reads a newer build filed

  A build before home pins files every read off the index path in one set, the
  collection's legacy bare set `fingerprint:<collection>:`, and a row write of
  that build reads that set and the index path's, no other. A newer build files
  such a read under its home pin, so it names it in the legacy bare set too, in
  the same fill: during a rolling deploy, a write on an older node then still
  drops it. A newer build's row write takes out of the legacy bare set every
  entry it drops, so the set names no dead entry. And it reads that set until a
  reap has adopted the collection, since an entry an older build filed is named
  nowhere else. The reap is set to once a year here, and the pass the boot asks
  for ends before any read is filed, so none adopts.

  The collections are scoped on name, the index path, and every read here is
  filtered on the primary key: filed under its home pin, off the index path.

  Scenario: a read filed under its home pin is named in the legacy bare set
    Given these rows of legacy_bare_named:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    Then the legacy bare set names what the home pin set does

  Scenario: an older build's write drops a read filed under its home pin
    Given these rows of legacy_bare_old_write:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    When an older build drops every entry the legacy bare set names
    Then these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: a newer build's write leaves no dead entry in the legacy bare set
    Given these rows of legacy_bare_new_write:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    When the row of ada is written
    Then the legacy bare set names nothing
    And these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |

  Scenario: a newer build's write drops a read only an older build named
    Given these rows of legacy_bare_old_fill:
      | name | label |
      | ada  | old   |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    And the home pin set is gone, as an older build files the read
    When the row of ada is written
    Then these reads answer:
      | name | fields     | cache |
      | ada  | name,label | MISS  |
