Feature: A row a mutation hook took over is purged from the response cache

  An `items.update` filter hook answering `{ key }` wrote that row itself,
  through the update's own transaction, before Directus checks the answer or
  writes anything. The scoped cache purges it whatever comes next: a refused
  answer, which takes the hook's write back with it, or an upsert that never
  sent the row. A row the caller sent was read before the hook ran, so
  only the slice it left and the one it moved to are purged. A row it did not
  send is purged with the collection whole, unless the hook declared that row's
  slices through `purgeBy` and `forKey`.

  A hook writing through the pool commits that write whatever the mutation
  does next, so a mutation failing after it, whether the hook threw or a later
  insert broke a constraint, still purges what the hook took over or declared.

  The cache-update-takeover hook acts on the body it is sent:
  - "take-over-twice" on test_takeover_refused: writes the row "taken-over"
    and answers with it twice.
  - "take-over-twice" on test_takeover_refused_pooled: the same, written
    through the extension's `database`, the pool, so the write is committed
    whether Directus accepts the answer or not.
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
    first one left. The row in slot "e" is sent nothing, so a purge of the
    collection whole is the only one reaching its slice.
  - "write-then-throw" on test_takeover_hook_threw: writes the row
    "written-by-hook" through the pool, declares the collection whole through
    `purgeBy`, then throws.
  - "take-over" on test_takeover_create_failed, a create: writes the row marked
    "taken" "taken-over" through the pool and takes it over. The create's other
    row reuses the key of the row marked "duplicate", so its insert fails.
  - "take-over" on test_takeover_nested_child, a create nested in an update of
    test_takeover_nested_parent: the same on the row marked "taken".
  - "write-then-throw" on test_takeover_nested_child, an update nested in an
    update of test_takeover_nested_parent: the same as on
    test_takeover_hook_threw.
  - "take-over-inert" on test_takeover_create_declared, a create: writes
    nothing, takes the row in slot "a" over declaring it inert through
    `skipPurgeFor`, and declares slot "a" through `purgeBy`.

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
      | cache | response             |
      | MISS  | [{body: "original"}] |

  Scenario: a refused answer purges the row its hook committed through the pool
    Given the read of test_takeover_refused_pooled is cached:
      | response             |
      | [{body: "original"}] |
    When its row is sent the body "take-over-twice"
    Then the update is refused with the message:
      """
      Invalid payload. A "items.update" filter hook answered with row {row} more than
      once.
      """
    And the read of test_takeover_refused_pooled answers:
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
      | a    | [{body: "original"}]  |
      | b    | [{body: "original"}]  |
      | e    | [{body: "bystander"}] |
    When both its rows are sent the body "move-both"
    Then the reads of test_takeover_partly_declared answer:
      | slot | cache | response              |
      | a    | MISS  | []                    |
      | b    | MISS  | []                    |
      | e    | HIT   | [{body: "bystander"}] |

  Scenario: a hook throwing after its own write still purges what it declared
    Given the read of test_takeover_hook_threw is cached:
      | response             |
      | [{body: "original"}] |
    When its row is sent the body "write-then-throw"
    Then the update fails with the status 500 and the message:
      """
      The body "write-then-throw" is refused
      """
    And the read of test_takeover_hook_threw answers:
      | cache | response                    |
      | MISS  | [{body: "written-by-hook"}] |

  Scenario: a failed create still purges the row its hook took over
    Given the read of test_takeover_create_failed marked "taken" is cached:
      | response             |
      | [{body: "original"}] |
    When a create sends "take-over" beside the key of the "duplicate" row
    Then the create is refused with the status 400 and the message:
      """
      Value for field "id" in collection "test_takeover_create_failed" has to be
      unique.
      """
    And the read of test_takeover_create_failed marked "taken" answers:
      | cache | response               |
      | MISS  | [{body: "taken-over"}] |

  Scenario: a failed nested create still purges the row its hook took over
    Given the read of test_takeover_nested_child marked "taken" is cached:
      | response             |
      | [{body: "original"}] |
    When the parent creates "take-over" beside the key of the "duplicate" child
    Then the update is refused with the status 400 and the message:
      """
      Value for field "id" in collection "test_takeover_nested_child" has to be
      unique.
      """
    And the read of test_takeover_nested_child marked "taken" answers:
      | cache | response               |
      | MISS  | [{body: "taken-over"}] |

  Scenario: a nested hook throwing after its own write still purges what it declared
    Given the read of test_takeover_nested_child marked "thrown" is cached:
      | response             |
      | [{body: "original"}] |
    When the parent sends its "thrown" child the body "write-then-throw"
    Then the update fails with the status 500 and the message:
      """
      The body "write-then-throw" is refused
      """
    And the read of test_takeover_nested_child marked "thrown" answers:
      | cache | response                    |
      | MISS  | [{body: "written-by-hook"}] |

  Scenario: a create whose takeover is inert purges only what its hook declared
    Given the read of test_takeover_create_declared is cached:
      | response             |
      | [{body: "original"}] |
    And the read of test_takeover_create_declared in slot "a" is cached:
      | response             |
      | [{body: "original"}] |
    When a create sends "take-over-inert"
    Then the read of test_takeover_create_declared answers:
      | cache | response             |
      | HIT   | [{body: "original"}] |
    And the read of test_takeover_create_declared in slot "a" answers:
      | cache | response             |
      | MISS  | [{body: "original"}] |
