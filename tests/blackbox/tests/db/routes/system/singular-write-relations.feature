Feature: A single relation is deleted by its collection and field

  - A request authenticates as the admin. A response cell states the keys it
    checks.

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

  Scenario: a relation updated with its meta alone keeps its foreign key
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /relations                     |           |
      | payload:                             |           |
      |   collection: test_sw_pets           |           |
      |   field: owner_ref                   |           |
      |   related_collection: test_sw_owners |           |
    Then these requests get these responses:
      | request                                 | response                          |
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
      |                                         |     meta:                         |
      |                                         |       many_collection: >-         |
      |                                         |         test_sw_pets              |
      |                                         |       many_field: owner_ref       |
      |                                         |       one_collection: >-          |
      |                                         |         test_sw_owners            |
      |                                         |       one_deselect_action: delete |
      | method: DELETE                          | code: 204                         |+
      | path: /relations/test_sw_pets/owner_ref |                                   |
