Feature: A relation update reaches a websocket subscriber as the change it made

  A subscriber to `directus_relations` receives the change itself, not the
  groups the update was carried in. The relation is the `author` field of
  `test_ws_relation_update_articles`, created with `one_deselect_action`
  set to `nullify`.

  Scenario: a relation update sends the subscriber the meta it changed
    Given a websocket subscriber to the relation updates
    When the relation's meta is patched with:
      """
      one_deselect_action: delete
      """
    Then the subscriber's first update message is:
      """
      type: subscription
      event: update
      data:
        one_deselect_action: delete
      """
