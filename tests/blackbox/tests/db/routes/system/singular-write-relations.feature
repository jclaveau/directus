Feature: A single relation is deleted by its collection and field

  - A request authenticates as the admin. A response cell states the keys it
    checks.
  - Clearing the system cache right before a PATCH makes that PATCH build the
    schema, so it is handed the frozen copy the cache keeps.

  Scenario: a relation deleted by its collection and field is gone
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /relations                     |           |
      | payload:                             |           |
      |   collection: test_sw_pets           |           |
      |   field: owner_ref                   |           |
      |   related_collection: test_sw_owners |           |
    Then these requests get these responses:
      | request                                 | response                       |
      | method: GET                             | code: 200                      |+
      | path: /relations/test_sw_pets           | body:                          |
      |                                         |   data:                        |
      |                                         |     - collection: test_sw_pets |
      |                                         |       field: owner_ref         |
      |                                         |       related_collection: >-   |
      |                                         |         test_sw_owners         |
      | method: DELETE                          | code: 204                      |+
      | path: /relations/test_sw_pets/owner_ref |                                |
      | method: GET                             | code: 200                      |+
      | path: /relations/test_sw_pets           | body:                          |
      |                                         |   data: []                     |

  Scenario: a relation updated with its meta alone keeps its foreign key as it was
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /relations                     |           |
      | payload:                             |           |
      |   collection: test_sw_pets           |           |
      |   field: owner_ref                   |           |
      |   related_collection: test_sw_owners |           |
      |   schema:                            |           |
      |     on_delete: SET NULL              |           |
    Then these requests get these responses:
      | request                                 | response                          |
      | method: GET                             | code: 200                         |+
      | path: /relations/test_sw_pets/owner_ref | body:                             |
      |                                         |   data:                           |
      |                                         |     schema:                       |
      |                                         |       table: test_sw_pets         |
      |                                         |       column: owner_ref           |
      | method: POST                            | code: 200                         |+
      | path: /utils/cache/clear?system         |                                   |
      | method: PATCH                           | code: 200                         |+
      | path: /relations/test_sw_pets/owner_ref |                                   |
      | payload:                                |                                   |
      |   meta:                                 |                                   |
      |     one_deselect_action: delete         |                                   |
      | method: GET                             | code: 200                         |+
      | path: /relations/test_sw_pets/owner_ref | body:                             |
      |                                         |   data:                           |
      |                                         |     schema:                       |
      |                                         |       table: test_sw_pets         |
      |                                         |       column: owner_ref           |
      |                                         |       foreign_key_table: >-       |
      |                                         |         test_sw_owners            |
      |                                         |       foreign_key_column: id      |
      |                                         |       on_delete: SET NULL         |
      |                                         |     meta:                         |
      |                                         |       many_collection: >-         |
      |                                         |         test_sw_pets              |
      |                                         |       many_field: owner_ref       |
      |                                         |       one_collection: >-          |
      |                                         |         test_sw_owners            |
      |                                         |       one_deselect_action: delete |
      | method: DELETE                          | code: 204                         |+
      | path: /relations/test_sw_pets/owner_ref |                                   |

  Scenario: a relation updated with one foreign key action keeps the other
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /relations                     |           |
      | payload:                             |           |
      |   collection: test_sw_pets           |           |
      |   field: owner_ref                   |           |
      |   related_collection: test_sw_owners |           |
      |   schema:                            |           |
      |     on_delete: SET NULL              |           |
      |     on_update: CASCADE               |           |
    Then these requests get these responses:
      | request                                 | response                    |
      | method: PATCH                           | code: 200                   |+
      | path: /relations/test_sw_pets/owner_ref |                             |
      | payload:                                |                             |
      |   schema:                               |                             |
      |     on_delete: CASCADE                  |                             |
      | method: GET                             | code: 200                   |+
      | path: /relations/test_sw_pets/owner_ref | body:                       |
      |                                         |   data:                     |
      |                                         |     schema:                 |
      |                                         |       table: test_sw_pets   |
      |                                         |       column: owner_ref     |
      |                                         |       on_delete: CASCADE    |
      |                                         |       on_update: CASCADE    |
      | method: DELETE                          | code: 204                   |+
      | path: /relations/test_sw_pets/owner_ref |                             |
