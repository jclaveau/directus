Feature: A mutation hook's write lands only with the mutation

  An update or delete filter hook writes through `context.transaction`, the
  transaction the mutation runs in, so a mutation the service refuses takes the
  hook's write back with it. The hook-write-rollback hook writes the note
  "written-by-hook" into the witness pointing at each row it is handed; it
  answers an update to the status "repeat-key" with that row twice. Every
  scenario owns its item collection, `<name>_item`, and the witness collection
  beside it, `<name>_witness`; a witness starts with the note "untouched".

  Scenario: an update the service refuses takes its hook's write back
    Given an item and its witness in test_hook_rollback_refused
    When the item is updated to the status "repeat-key"
    Then the mutation is refused with the status 400 and the message:
      """
      Invalid payload. A "items.update" filter hook answered with row {item} more than
      once.
      """
    And the witness holds the note "untouched"

  Scenario: an update the service accepts keeps its hook's write
    Given an item and its witness in test_hook_rollback_accepted
    When the item is updated to the status "archived"
    Then the mutation answers 200
    And the witness holds the note "written-by-hook"

  Scenario: a delete the access check refuses takes its hook's write back
    Given an item and its witness in test_hook_rollback_forbidden
    When a user with no role deletes the item
    Then the mutation is refused with the status 403 and the message:
      """
      You don't have permission to access collection "test_hook_rollback_forbidden_item"
      or it does not exist. Queried in root.
      """
    And the witness holds the note "untouched"
