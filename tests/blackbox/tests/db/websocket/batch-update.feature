Feature: A batch update reaches a websocket subscriber as one message

  A batch carrying several changes is one update: its groups reach the
  `items.update` action together, so a subscriber hears of it once, the
  message holding every row the batch wrote. The rows live in
  `test_ws_batch_update`. A row is named by the `name` it was created with.

  Scenario: a batch carrying two changes reaches a subscriber as one message
    Given the rows:
      | name |
      | ws-a |
      | ws-b |
      | ws-c |
    And a websocket subscriber to the rows
    When the batch sends:
      | name | status   |
      | ws-a | archived |
      | ws-b | kept     |
      | ws-c | archived |
    Then the subscriber's first update message holds:
      | name | status   |
      | ws-a | archived |
      | ws-b | kept     |
      | ws-c | archived |
