Feature: A row an update hook took over is purged from the response cache

  An `items.update` filter hook answering `{ key }` wrote that row itself, out
  of band, before Directus checks the answer or writes anything. The scoped
  cache purges it whatever comes next: a refused answer, or an upsert that
  never sent the row. A row the caller sent was read before the hook ran, so
  only the slice it left and the one it moved to are purged. A row it did not
  send is purged with the collection whole, unless the hook declared that row's
  slices through `purgeBy` and `forKey`.

  The cache-update-takeover hook acts on the body it is sent:
  - "take-over-twice" on test_takeover_refused: writes the row "taken-over"
    and answers with it twice.
  - "take-over-sibling" on test_takeover_upsert_child: writes the row marked
    "sibling" "taken-over" and adds it to its answer.
  - "take-over-inert" on test_takeover_inert: writes nothing and takes the row
    over, declaring it inert through `skipPurgeFor` with a zero leading its key.
  - "take-over-inert" on test_takeover_inert_big: the same, on a bigInteger
    primary key.
  - "move-to-b" on test_takeover_moved: moves the row to slot "b" and takes it
    over, declaring nothing.
  - "move-both" on test_takeover_partly_declared: moves the first row to slot
    "c" and the second to "d", takes both over, and declares the slice only the
    first one left.

  Scenario: a refused answer still purges the row its hook took over
    Given the read of test_takeover_refused is cached:
      | response             |
      | [{body: "original"}] |
    When its row is sent the body "take-over-twice"
    Then the update is refused with the message:
      """
      Invalid payload. A "items.update" filter hook answered with row {row} more than
      once.
      """
    And the read of test_takeover_refused answers:
      | cache | response               |
      | MISS  | [{body: "taken-over"}] |

  Scenario: an upsert whose hook takes over a row it never sent purges that row
    Given the read of test_takeover_upsert_child in slot "b" is cached:
      | response             |
      | [{body: "original"}] |
    When the parent sends its child the body "take-over-sibling"
    Then the read of test_takeover_upsert_child in slot "b" answers:
      | cache | response               |
      | MISS  | [{body: "taken-over"}] |

  Scenario: a takeover declared inert under another spelling of its key purges nothing
    Given the read of test_takeover_inert is cached:
      | response             |
      | [{body: "original"}] |
    When its row is sent the body "take-over-inert"
    Then the read of test_takeover_inert answers:
      | cache | response             |
      | HIT   | [{body: "original"}] |

  Scenario: a bigInteger takeover declared inert under a zero-led key purges nothing
    Given the read of test_takeover_inert_big is cached:
      | response             |
      | [{body: "original"}] |
    When its row is sent the body "take-over-inert"
    Then the read of test_takeover_inert_big answers:
      | cache | response             |
      | HIT   | [{body: "original"}] |

  Scenario: an undeclared takeover of a sent row purges only the slices it moved between
    Given the reads of test_takeover_moved are cached:
      | slot | response              |
      | a    | [{body: "original"}]  |
      | b    | []                    |
      | c    | [{body: "bystander"}] |
    When its row in slot "a" is sent the body "move-to-b"
    Then the reads of test_takeover_moved answer:
      | slot | cache | response              |
      | a    | MISS  | []                    |
      | b    | MISS  | [{body: "moved"}]     |
      | c    | HIT   | [{body: "bystander"}] |

  Scenario: a takeover declaring one of two rows still purges the slice the other left
    Given the reads of test_takeover_partly_declared are cached:
      | slot | response             |
      | a    | [{body: "original"}] |
      | b    | [{body: "original"}] |
    When both its rows are sent the body "move-both"
    Then the reads of test_takeover_partly_declared answer:
      | slot | cache | response |
      | a    | MISS  | []       |
      | b    | MISS  | []       |
