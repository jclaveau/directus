Feature: An event flow runs once per change, as it did before updates carried groups

  An update reaches its hooks as `{ data, keys }[]` groups. An event flow on
  `items.update` runs once per group, its `$trigger` shaped like the single
  update the flow was written for: `{ payload: data, keys }`. A filter flow
  returning `$last` replaces that group's change. A flow on `items.create` runs
  once per created row. Every run leaves a revision holding its `$trigger`,
  read back here. A row is named by the `name` it was created with; a user by
  its first name.

  The flows on each collection:
  - test_event_flow_runs: an update filter, an update action, a create action.
  - test_event_flow_rewrites: a filter returning `{ "status": "set-by-flow" }`.
  - test_event_flow_refusals: a filter returning `null`.
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

  Scenario: a batch carrying two changes runs each update flow once per change
    Given the rows of test_event_flow_runs:
      | name  |
      | two-a |
      | two-b |
      | two-c |
    When the batch sends:
      | name  | status   |
      | two-a | archived |
      | two-b | kept     |
      | two-c | archived |
    Then the "update filter" flow ran with:
      | status   | names             |
      | archived | ["two-a","two-c"] |
      | kept     | ["two-b"]         |
    And the "update action" flow ran with:
      | status   | names             |
      | archived | ["two-a","two-c"] |
      | kept     | ["two-b"]         |

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
    Then the update is refused with a reason naming "items.update.one"
    And the rows hold:
      | name     | status |
      | refuse-a |        |
      | refuse-b |        |

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
