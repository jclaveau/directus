Feature: An event flow runs once per change, as it did before updates carried groups

  An update reaches its hooks as `{ data, keys }[]` groups. An event flow on
  `items.update` runs once per group, its `$trigger` shaped like the single
  update the flow was written for: `{ payload: data, keys }`. A batch sends one
  group per row; the rows carrying the same change are merged after the filter,
  so the action runs once per change. A filter flow returning `$last` replaces
  that group's change. A flow on `items.create` runs once per created row, and a
  filter flow's return answers that row as a hook's does: a key takes it over,
  null cancels it. Every run leaves a revision holding its `$trigger`, read back
  here. A row is named by the `name` it was created with; a user by its first
  name.

  The flows on each collection:
  - test_event_flow_runs: an update filter, an update action, a create action.
  - test_event_flow_rewrites: a filter returning `{ "status": "set-by-flow" }`.
  - test_event_flow_refusals: a filter returning `null`.
  - test_event_flow_takeovers: a create filter returning the key 1, the row the
    seed inserted before the flow existed.
  - test_event_flow_cancels: a create filter returning `null`.
  - test_event_flow_keys: an update filter returning the key 7.
  - directus_users: an update filter, an update action.

  Scenario: an update of several rows to one status runs each update flow once
    Given the rows of test_event_flow_runs:
      | name    |
      | one-a   |
      | one-b   |
      | one-c   |
    When the rows are updated to the status "archived"
    Then the "update filter" flow ran with:
      | status   | names                     |
      | archived | ["one-a","one-b","one-c"] |
    And the "update action" flow ran with:
      | status   | names                     |
      | archived | ["one-a","one-b","one-c"] |

  Scenario: a batch runs the update filter once per row, the action once per change
    Given the rows of test_event_flow_runs:
      | name  |
      | two-a |
      | two-b |
      | two-c |
    When the batch sends:
      | name  | status   |
      | two-a | archived |
      | two-b | archived |
      | two-c | kept     |
    Then the "update filter" flow ran with:
      | status   | names     |
      | archived | ["two-a"] |
      | archived | ["two-b"] |
      | kept     | ["two-c"] |
    And the "update action" flow ran with:
      | status   | names             |
      | archived | ["two-a","two-b"] |
      | kept     | ["two-c"]         |

  Scenario: a create runs the create flow once per row
    Given the rows of test_event_flow_runs:
      | name     |
      | create-a |
      | create-b |
    Then the "create action" flow ran once for each of:
      | name     |
      | create-a |
      | create-b |

  Scenario: a filter flow's return replaces the change it was given
    Given the rows of test_event_flow_rewrites:
      | name      |
      | rewrite-a |
      | rewrite-b |
    When the rows are updated to the status "archived"
    Then the rows hold:
      | name      | status      |
      | rewrite-a | set-by-flow |
      | rewrite-b | set-by-flow |

  Scenario: a filter flow returning null refuses the update
    Given the rows of test_event_flow_refusals:
      | name     |
      | refuse-a |
      | refuse-b |
    When the rows are updated to the status "archived"
    Then the update is refused with the message:
      """
      Invalid payload. A flow on "test_event_flow_refusals.items.update" returned null
      for rows {refuse-a}, {refuse-b}; an update flow returns the change to write, or
      nothing to keep the change sent.
      """
    And the rows hold:
      | name     | status |
      | refuse-a |        |
      | refuse-b |        |

  Scenario: an update filter flow returning a key refuses the update
    Given the rows of test_event_flow_keys:
      | name  |
      | key-a |
      | key-b |
    When the rows are updated to the status "archived"
    Then the update is refused with the message:
      """
      Invalid payload. A flow on "test_event_flow_keys.items.update" returned the key 7
      for rows {key-a}, {key-b}; an update flow returns the change to write, or nothing
      to keep the change sent.
      """
    And the rows hold:
      | name  | status |
      | key-a |        |
      | key-b |        |

  Scenario: an update of several users runs each users update flow once
    Given the users:
      | name     |
      | user-a   |
      | user-b   |
    When the rows are updated to the status "suspended"
    Then the "users update filter" flow ran with:
      | status    | names               |
      | suspended | ["user-a","user-b"] |
    And the "users update action" flow ran with:
      | status    | names               |
      | suspended | ["user-a","user-b"] |

  Scenario: a create filter flow returning a key takes the row over
    When the rows are created in test_event_flow_takeovers:
      | name       |
      | takeover-a |
    Then the create answers:
      | id | name    |
      | 1  | claimed |
    And test_event_flow_takeovers holds:
      | id | name    |
      | 1  | claimed |

  Scenario: a create filter flow returning null cancels the row
    When the rows are created in test_event_flow_cancels:
      | name     |
      | cancel-a |
      | cancel-b |
    Then the create answers no row
    And test_event_flow_cancels holds no row
