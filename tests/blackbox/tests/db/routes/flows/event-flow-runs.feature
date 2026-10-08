Feature: An event flow runs once per change, as it did before updates carried groups

  An update reaches its hooks as `{ data, keys }[]` groups. An event flow on
  `items.update` runs once per group, its `$trigger` shaped like the single
  update the flow was written for: `{ payload: data, keys }`. A flow on
  `items.create` runs once per created row. The flows live on
  `test_event_flow_runs`; every run leaves a revision holding its `$trigger`,
  read back here. A row is named by the `name` it was created with.

  Scenario: an update of several rows to one status runs each update flow once
    Given the rows:
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
    Given the rows:
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
    Given the rows:
      | name     |
      | create-a |
      | create-b |
    Then the "create action" flow ran once for each of:
      | name     |
      | create-a |
      | create-b |
