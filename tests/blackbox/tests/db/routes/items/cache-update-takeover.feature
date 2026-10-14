Feature: A row an update hook took over is purged from the response cache

  An `items.update` filter hook answering `{ key }` wrote that row itself, out
  of band, before Directus checks the answer or writes anything. The scoped
  cache purges it whatever comes next: a refused answer, or an upsert that
  never sent the row. With no `purgeBy` the hook named no slice, so the
  collection is purged whole.

  The cache-update-takeover hook acts on the body it is sent:
  - "take-over-twice" on test_takeover_refused: writes the row "taken-over"
    and answers with it twice.
  - "take-over-sibling" on test_takeover_upsert_child: writes the row marked
    "sibling" "taken-over" and adds it to its answer.

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
