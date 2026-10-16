Feature: An update reaches its hooks as one grouped event

  Every update reaches its hooks as groups: one `items.update` event carrying
  `{ data, keys }[]`; a hook written for one row maps the groups with
  `mapUpdateRows`. The rows live in
  `test_update_groups`, whose events the update-groups-probe hook writes into a
  log read back here. A row is named by the `name` it was created with; a
  blank cell in what a batch sends leaves that field out, so the row sends its
  key alone. The log is emptied before each scenario.
  `test_update_groups_owner` holds rows too, and no update hook listens to it.
  `test_update_groups_slot` lets a holder hold each slot once (a unique
  `(holder, slot)`), and no update hook listens to it either.
  `test_update_groups_badge` is keyed by uuid, and no update hook listens to
  it.

  A batch sending one row twice is refused unless it passes
  `onRepeatedPk=lastWins`, which writes each change in the order sent. A system
  collection's own route, such as `/users` or `update_users_batch`, takes no
  `onRepeatedPk`, so it always refuses, naming no option. A uuid names one row
  whatever the case of its letters, an integer whatever zeros lead it.

  The probe acts on these markers:
  - name "cancel-me": the grouped filter's `mapUpdateRows` cancels the row.
  - name "rewrite-me": `mapUpdateRows` renames the row "rewritten".
  - name "take-over-me": `mapUpdateRows` writes the row's status
    "taken-over" itself and returns its key, taking the row over.
  - status "one-row-shape": the grouped filter answers with that group's
    payload alone, the shape a hook written for one row returns.
  - status "drop-key": the grouped filter drops that group's first key,
    cancelling that row.
  - status "repeat-key": the grouped filter answers with that group's first
    key a second time, in a group of its own.
  - status "strip-name": the grouped filter deletes `name` off the list itself.
  - status "check-status": the grouped filter reads `status` off the list
    itself, throwing when it reads "check-status".
  - status "add-row": the grouped filter adds the row named "added-by-hook" to
    that group's keys.

  Scenario: an update fires the grouped event once
    Given the rows:
      | name    |
      | a-one   |
      | a-two   |
      | a-three |
    When the rows are updated to the status "archived"
    Then the grouped filter carries:
      | status   | names                       |
      | archived | ["a-one","a-two","a-three"] |
    And the update events are:
      | event        | phase  | count |
      | items.update | filter | 1     |
      | items.update | action | 1     |

  Scenario: a batch where every row writes nothing answers with every row
    Given the rows:
      | name   |
      | noop-a |
      | noop-b |
    When the batch sends:
      | name   | status |
      | noop-a |        |
      | noop-b |        |
    Then the update answers:
      | name   | status |
      | noop-a |        |
      | noop-b |        |
    And the rows hold:
      | name   | status |
      | noop-a |        |
      | noop-b |        |

  Scenario: a batch answers with every row it was sent, no-op rows included
    Given the rows:
      | name     |
      | noop-one |
      | noop-two |
    When the batch sends:
      | name     | status   |
      | noop-one |          |
      | noop-two | archived |
    Then the update answers:
      | name     | status   |
      | noop-one |          |
      | noop-two | archived |

  Scenario: rows side by side carrying the same change are written together
    Given the rows:
      | name   |
      | next-a |
      | next-b |
      | next-c |
    When the batch sends:
      | name   | status   |
      | next-a | archived |
      | next-b | archived |
      | next-c | kept     |
    Then the grouped action carries:
      | status   | names               |
      | archived | ["next-a","next-b"] |
      | kept     | ["next-c"]          |

  Scenario: rows apart carrying the same change are written in the order sent
    Given the rows:
      | name    |
      | apart-a |
      | apart-b |
      | apart-c |
    When the batch sends:
      | name    | status   |
      | apart-a | archived |
      | apart-b | kept     |
      | apart-c | archived |
    Then the grouped action carries:
      | status   | names       |
      | archived | ["apart-a"] |
      | kept     | ["apart-b"] |
      | archived | ["apart-c"] |
    And the update events are:
      | event        | phase  | count |
      | items.update | filter | 1     |
      | items.update | action | 1     |

  Scenario: a batch writes its revisions in the order it sends its rows
    Given the rows, in the collection no update hook listens to:
      | name      |
      | ordered-a |
      | ordered-b |
      | ordered-c |
    When the batch sends:
      | name      | status   |
      | ordered-a | archived |
      | ordered-b | kept     |
      | ordered-c | archived |
    Then the update succeeds
    And the revisions name the rows in this order:
      | name      |
      | ordered-a |
      | ordered-b |
      | ordered-c |

  Scenario: a batch hands a slot over when a row frees it before the next takes it
    Given the rows, in the collection holding each slot once per holder:
      | name   | holder | slot |
      | hand-a | first  |      |
      | hand-b | second | open |
      | hand-c | second |      |
    When the batch sends the slots:
      | name   | slot   |
      | hand-a | open   |
      | hand-b | closed |
      | hand-c | open   |
    Then the update succeeds
    And the slots hold:
      | name   | holder | slot   |
      | hand-a | first  | open   |
      | hand-b | second | closed |
      | hand-c | second | open   |

  Scenario: a row a batch changes back and forth keeps the last change it was sent
    Given the rows:
      | name       |
      | back-forth |
    When the batch sends, with onRepeatedPk "lastWins":
      | name       | status   |
      | back-forth | archived |
      | back-forth | kept     |
      | back-forth | archived |
    Then the update succeeds
    And the rows hold:
      | name       | status   |
      | back-forth | archived |

  Scenario: a row a non-admin sends twice with one change is checked and written once
    Given the rows:
      | name  |
      | twice |
    And the requests authenticate as a user who may read and update the rows
    When the batch sends, with onRepeatedPk "lastWins":
      | name  | status   |
      | twice | archived |
      | twice | archived |
    Then the grouped action carries:
      | status   | names     |
      | archived | ["twice"] |
    And the rows hold:
      | name  | status   |
      | twice | archived |

  Scenario: a batch sending a row twice is refused before any update hook runs
    Given the rows:
      | name     |
      | repeat-a |
      | repeat-b |
    When the batch sends:
      | name     | status   |
      | repeat-a | archived |
      | repeat-b | kept     |
      | repeat-a | kept     |
    Then the update is refused with the message:
      """
      Invalid payload. Row {repeat-a} is sent more than once; send each row once, or pass
      onRepeatedPk=lastWins.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name     | status |
      | repeat-a |        |
      | repeat-b |        |
    And no update event was logged

  Scenario: a batch passing an unknown onRepeatedPk is refused before any hook
    Given the rows:
      | name      |
      | unknown-a |
    When the batch sends, with onRepeatedPk "merge":
      | name      | status   |
      | unknown-a | archived |
    Then the update is refused with the message:
      """
      Invalid query. "onRepeatedPk" must be one of refuse, lastWins.
      """
    And the refusal's code is "INVALID_QUERY"
    And the rows hold:
      | name      | status |
      | unknown-a |        |
    And no update event was logged

  Scenario: a batch sending a uuid twice, once in capitals, is refused
    Given the rows, in the collection keyed by uuid:
      | name    |
      | badge-a |
    When the batch sends, the key of its last row in capitals:
      | name    | status   |
      | badge-a | archived |
      | badge-a | kept     |
    Then the update is refused with the message:
      """
      Invalid payload. Row {badge-a} is sent more than once; send each row once, or pass
      onRepeatedPk=lastWins.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name    | status |
      | badge-a |        |

  Scenario: a batch sending a row twice, once with a leading zero, is refused
    Given the rows:
      | name   |
      | zero-a |
    When the batch sends, the key of its last row with a leading zero:
      | name   | status   |
      | zero-a | archived |
      | zero-a | kept     |
    Then the update is refused with the message:
      """
      Invalid payload. Row {zero-a} is sent more than once; send each row once, or pass
      onRepeatedPk=lastWins.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name   | status |
      | zero-a |        |

  Scenario: a GraphQL batch sending a row twice is refused before any hook
    Given the rows:
      | name      |
      | gql-twice |
    When the batch is sent over GraphQL:
      | name      | status   |
      | gql-twice | archived |
      | gql-twice | kept     |
    Then the GraphQL update is refused with the message:
      """
      Invalid payload. Row {gql-twice} is sent more than once; send each row once, or pass
      onRepeatedPk: lastWins.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name      | status |
      | gql-twice |        |
    And no update event was logged

  Scenario: a GraphQL batch passing onRepeatedPk lastWins keeps the last change
    Given the rows:
      | name     |
      | gql-last |
    When the batch is sent over GraphQL, with onRepeatedPk lastWins:
      | name     | status   |
      | gql-last | archived |
      | gql-last | kept     |
    Then the GraphQL update succeeds
    And the rows hold:
      | name     | status |
      | gql-last | kept   |

  Scenario: a GraphQL batch passing an unknown onRepeatedPk is refused
    Given the rows:
      | name        |
      | gql-unknown |
    When the batch is sent over GraphQL, with onRepeatedPk merge:
      | name        | status   |
      | gql-unknown | archived |
    Then the GraphQL query is rejected with the message:
      """
      Value "merge" does not exist in "directus_repeated_pk_answer" enum.
      """
    And the rows hold:
      | name        | status |
      | gql-unknown |        |
    And no update event was logged

  Scenario: the OAS describes onRepeatedPk on a collection's batch update
    When the OAS is read
    Then the collection's update references the OnRepeatedPk parameter
    And the OAS describes the OnRepeatedPk parameter

  Scenario: a row sent twice under one change reaches the hooks once
    Given the rows:
      | name     |
      | same-key |
    When the rows are sent twice, updated to the status "archived"
    Then the grouped filter carries:
      | status   | names        |
      | archived | ["same-key"] |
    And the rows hold:
      | name     | status   |
      | same-key | archived |

  Scenario: a grouped hook answering with a row twice is refused, writing nothing
    Given the rows:
      | name     |
      | answer-a |
      | answer-b |
    When the batch sends:
      | name     | status     |
      | answer-a | archived   |
      | answer-b | repeat-key |
    Then the update is refused with the message:
      """
      Invalid payload. A "items.update" filter hook answered with row {answer-b} more than
      once.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name     | status |
      | answer-a |        |
      | answer-b |        |

  Scenario: a grouped hook answering with one payload is refused, naming the helper
    Given the rows:
      | name     |
      | single-a |
      | single-b |
    When the batch sends:
      | name     | status        |
      | single-a | archived      |
      | single-b | one-row-shape |
    Then the update is refused with the message:
      """
      Invalid payload. A "items.update" filter hook must return the { data, keys }[] it
      received, a row it wrote itself as { key }, no key both; a hook that handles one row
      maps them with mapUpdateRows.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name     | status |
      | single-a |        |
      | single-b |        |

  Scenario: a grouped hook dropping a key cancels that row, its sibling written
    Given the rows:
      | name   |
      | drop-a |
      | drop-b |
    When the rows are updated to the status "drop-key"
    Then the grouped action carries:
      | status   | names      |
      | drop-key | ["drop-b"] |
    And the rows hold:
      | name   | status   |
      | drop-a |          |
      | drop-b | drop-key |

  Scenario: a grouped hook deleting a field off the list is refused, writing nothing
    Given the rows:
      | name    |
      | strip-a |
      | strip-b |
    When the batch sends:
      | name    | status     |
      | strip-a | archived   |
      | strip-b | strip-name |
    Then the update is refused with the message:
      """
      Invalid payload. A "items.update" filter hook must return the { data, keys }[] it
      received, a row it wrote itself as { key }, no key both; a hook that handles one row
      maps them with mapUpdateRows.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name    | status |
      | strip-a |        |
      | strip-b |        |

  Scenario: a grouped hook reading a field off the list is refused, writing nothing
    Given the rows:
      | name    |
      | check-a |
      | check-b |
    When the batch sends:
      | name    | status       |
      | check-a | archived     |
      | check-b | check-status |
    Then the update is refused with the message:
      """
      Invalid payload. A "items.update" filter hook must return the { data, keys }[] it
      received, a row it wrote itself as { key }, no key both; a hook that handles one row
      maps them with mapUpdateRows.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the rows hold:
      | name    | status |
      | check-a |        |
      | check-b |        |

  Scenario: a malformed key is refused before any update hook runs
    When a malformed key is updated to the status "archived"
    Then the update is refused with the message:
      """
      Invalid payload. Primary key of test_update_groups must be an integer instead of
      "not-a-key".
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And no update event was logged

  Scenario: an update naming no row runs no update hook
    When no row is updated to the status "archived"
    Then the update succeeds
    And no update event was logged

  Scenario: a batch no update hook listens to is written as it was sent
    Given the rows, in the collection no update hook listens to:
      | name   |
      | bare-a |
      | bare-b |
      | bare-c |
    When the batch sends:
      | name   | status   |
      | bare-a | archived |
      | bare-b | kept     |
      | bare-c | archived |
    Then the update answers:
      | name   | status   |
      | bare-a | archived |
      | bare-b | kept     |
      | bare-c | archived |
    And the rows hold:
      | name   | status   |
      | bare-a | archived |
      | bare-b | kept     |
      | bare-c | archived |
    And no update event was logged

  Scenario: an update sending null for its data is refused, naming no hook
    Given the rows, in the collection no update hook listens to:
      | name      |
      | no-data-a |
    When the rows are updated with null for their data
    Then the update is refused with the message:
      """
      Invalid payload. Each update group needs a "data" object.
      """
    And the refusal's code is "INVALID_PAYLOAD"

  Scenario: a hook mapping its rows cancels one, its siblings written together
    Given the rows:
      | name      |
      | cancel-me |
      | c-two     |
      | c-three   |
    When the rows are updated to the status "archived"
    Then the grouped action carries:
      | status   | names               |
      | archived | ["c-two","c-three"] |
    And the rows hold:
      | name      | status   |
      | cancel-me |          |
      | c-two     | archived |
      | c-three   | archived |

  Scenario: a hook mapping its rows splits off the one it rewrote
    Given the rows:
      | name       |
      | d-one      |
      | rewrite-me |
      | d-three    |
    When the rows are updated to the status "archived"
    Then the grouped action carries:
      | status   | names               |
      | archived | ["d-one","d-three"] |
      | archived | ["rewrite-me"]      |
    And the rows hold:
      | name      | status   |
      | d-one     | archived |
      | rewritten | archived |
      | d-three   | archived |

  Scenario: a hook mapping its rows takes one over, Directus writing the others
    Given the rows:
      | name         |
      | take-over-me |
      | t-two        |
      | t-three      |
    When the rows are updated to the status "archived"
    Then the grouped action carries:
      | status   | names               |
      | archived | ["t-two","t-three"] |
    And the rows hold:
      | name         | status     |
      | take-over-me | taken-over |
      | t-two        | archived   |
      | t-three      | archived   |

  Scenario: a nested owner sent to several rows a hook maps is created once
    Given the rows:
      | name    |
      | owned-a |
      | owned-b |
    When the rows are updated to point at a new owner named "shared-owner"
    Then the update succeeds
    And the rows point at the one owner named "shared-owner"

  Scenario: a row a hook adds to an update is written, left out of the answer
    Given the rows:
      | name          |
      | added-by-hook |
      | add-one       |
    When the batch sends:
      | name    | status  |
      | add-one | add-row |
    Then the update answers:
      | name    | status  |
      | add-one | add-row |
    And the rows hold:
      | name          | status  |
      | added-by-hook | add-row |
      | add-one       | add-row |

  Scenario: a users batch sending a user twice is refused, no onRepeatedPk to pass
    Given the users:
      | name        |
      | repeat-user |
    When the users batch sends:
      | name        | status    |
      | repeat-user | suspended |
      | repeat-user | archived  |
    Then the update is refused with the message:
      """
      Invalid payload. Row {repeat-user} is sent more than once; send each row once.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the users hold:
      | first_name  | status |
      | repeat-user | active |

  Scenario: a GraphQL users batch sending a user twice is refused, naming no option
    Given the users:
      | name     |
      | gql-user |
    When the users batch is sent over GraphQL:
      | name     | status    |
      | gql-user | suspended |
      | gql-user | archived  |
    Then the GraphQL update is refused with the message:
      """
      Invalid payload. Row {gql-user} is sent more than once; send each row once.
      """
    And the refusal's code is "INVALID_PAYLOAD"
    And the users hold:
      | first_name | status |
      | gql-user   | active |

  Scenario: a GraphQL users batch passing onRepeatedPk is rejected
    Given the users:
      | name        |
      | gql-lastwin |
    When the users batch is sent over GraphQL, with onRepeatedPk lastWins:
      | name        | status    |
      | gql-lastwin | suspended |
    Then the GraphQL query is rejected with the message:
      """
      Unknown argument "onRepeatedPk" on field "Mutation.update_users_batch".
      """
    And the users hold:
      | first_name  | status |
      | gql-lastwin | active |
