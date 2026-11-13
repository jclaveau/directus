Feature: A batch update reaches a websocket subscriber as one message

  A batch carrying several changes is one update: its groups reach the
  `items.update` action together, so a subscriber hears of it once, the
  message holding every row the batch wrote. The rows live in
  `test_ws_batch_update`. A row is named by the `name` it was created with.
  A lone update sent after the batch closes the list: its message must come
  right after the batch's, so nothing else was sent in between.

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
    And a lone update then sends:
      | name | status |
      | ws-b | lone   |
    Then the subscriber's first update message holds:
      | name | status   |
      | ws-a | archived |
      | ws-b | kept     |
      | ws-c | archived |
    And its second update message, the lone update's, holds:
      | name | status |
      | ws-b | lone   |
    And the subscriber received no other message
