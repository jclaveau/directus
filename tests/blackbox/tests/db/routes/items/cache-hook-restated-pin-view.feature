Feature: A hook naming a row the read already pins drops that collection's view

  A read's fingerprint of a collection carries the view it selected, and a write
  touching none of those columns leaves the entry cached. A read hook that
  enriches the response reads columns outside the AST, so the collection a hook
  names is filed with no view: every write to it touches the entry.

  The view was only dropped when the hook's pin was new. A hook restating a pin
  the read had already computed, here the row the read fetched by its key, was
  deduplicated into the computed one and kept the read's narrow view, so a write
  to the column the hook added left the response cached with its old value.

  Both hook channels restate the pin: `scopedCache.dependOn` handing over a
  lookup of the row, and a `cache.scope` filter returning the row's key pin. Each
  collection carries a `note` no read names, so no view covers the whole
  collection.

  Scenario: a write to the column a dependOn lookup added purges the read
    Given this row of hook_restated_depend_on:
      | name | bio | note |
      | ada  | old | n    |
    And this read of the row is cached:
      | fields  | response                     |
      | id,name | {id: 1, name: ada, bio: old} |
    When the row's bio is written:
      | bio |
      | new |
    Then the read is filled again:
      | fields  | response                     |
      | id,name | {id: 1, name: ada, bio: new} |

  Scenario: a write to the column a cache.scope hook added purges the read
    Given this row of hook_restated_cache_scope:
      | name | bio | note |
      | ada  | old | n    |
    And this read of the row is cached:
      | fields  | response                     |
      | id,name | {id: 1, name: ada, bio: old} |
    When the row's bio is written:
      | bio |
      | new |
    Then the read is filled again:
      | fields  | response                     |
      | id,name | {id: 1, name: ada, bio: new} |
