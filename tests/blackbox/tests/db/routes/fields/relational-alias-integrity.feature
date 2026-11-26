Feature: A relational alias is created once a relation names it

  - A request authenticates as the admin. A response cell states the keys it
    checks.
  - A relational alias (special o2m, m2m, m2a, translations or files) no
    directus_relations row names in one_collection and one_field is read as a
    column, and every read of its collection then answers 500 on a column the
    table does not hold (#381). Each scenario holds collections of its own.

  Scenario: an o2m alias created after the relation naming it reads back
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /collections                |           |
      | payload:                          |           |
      |   collection: order_owner         |           |
      |   schema: {}                      |           |
      |   meta: {}                        |           |
      |   fields:                         |           |
      |     - field: id                   |           |
      |       type: integer               |           |
      |       schema:                     |           |
      |         is_primary_key: true      |           |
      |         has_auto_increment: true  |           |
      | method: POST                      | code: 200 |+
      | path: /collections                |           |
      | payload:                          |           |
      |   collection: order_item          |           |
      |   schema: {}                      |           |
      |   meta: {}                        |           |
      |   fields:                         |           |
      |     - field: id                   |           |
      |       type: integer               |           |
      |       schema:                     |           |
      |         is_primary_key: true      |           |
      |         has_auto_increment: true  |           |
      |     - field: owner                |           |
      |       type: integer               |           |
      |       schema: {}                  |           |
      |       meta: {}                    |           |
      | method: POST                      | code: 200 |+
      | path: /relations                  |           |
      | payload:                          |           |
      |   collection: order_item          |           |
      |   field: owner                    |           |
      |   related_collection: order_owner |           |
      |   meta:                           |           |
      |     one_field: owned_items        |           |
    Then these requests get these responses:
      | request                               | response                    |
      | method: POST                          | code: 200                   |+
      | path: /fields/order_owner             |                             |
      | payload:                              |                             |
      |   field: owned_items                  |                             |
      |   type: alias                         |                             |
      |   meta:                               |                             |
      |     special:                          |                             |
      |       - o2m                           |                             |
      |     interface: list-o2m               |                             |
      | method: GET                           | code: 200                   |+
      | path: /fields/order_owner/owned_items | body:                       |
      |                                       |   data:                     |
      |                                       |     collection: order_owner |
      |                                       |     field: owned_items      |
      |                                       |     type: alias             |
      |                                       |     meta:                   |
      |                                       |       special:              |
      |                                       |         - o2m               |
      | method: GET                           | code: 200                   |+
      | path: /items/order_owner              | body:                       |
      | query:                                |   data: []                  |
      |   fields:                             |                             |
      |     - id                              |                             |
      |     - owned_items                     |                             |

  Scenario: an o2m alias no relation names yet is refused, and leaves no field
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /collections               |           |
      | payload:                         |           |
      |   collection: first_owner        |           |
      |   schema: {}                     |           |
      |   meta: {}                       |           |
      |   fields:                        |           |
      |     - field: id                  |           |
      |       type: integer              |           |
      |       schema:                    |           |
      |         is_primary_key: true     |           |
      |         has_auto_increment: true |           |
    Then these requests get these responses:
      | request                               | response                        |
      | method: POST                          | code: 400                       |+
      | path: /fields/first_owner             | body:                           |
      | payload:                              |   errors:                       |
      |   field: owned_items                  |     - message: >-               |
      |   type: alias                         |         Invalid payload.        |
      |   meta:                               |         Field "owned_items" of  |
      |     special:                          |         "first_owner" is an o2m |
      |       - o2m                           |         alias no relation names |
      |     interface: list-o2m               |         in one_field.           |
      | method: GET                           | code: 403                       |+
      | path: /fields/first_owner/owned_items |                                 |
      | method: GET                           | code: 200                       |+
      | path: /items/first_owner              | body:                           |
      | query:                                |   data: []                      |
      |   fields:                             |                                 |
      |     - id                              |                                 |

  Scenario: deleting a relation deletes the o2m alias its one_field named
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /collections                 |           |
      | payload:                           |           |
      |   collection: delete_owner         |           |
      |   schema: {}                       |           |
      |   meta: {}                         |           |
      |   fields:                          |           |
      |     - field: id                    |           |
      |       type: integer                |           |
      |       schema:                      |           |
      |         is_primary_key: true       |           |
      |         has_auto_increment: true   |           |
      | method: POST                       | code: 200 |+
      | path: /collections                 |           |
      | payload:                           |           |
      |   collection: delete_item          |           |
      |   schema: {}                       |           |
      |   meta: {}                         |           |
      |   fields:                          |           |
      |     - field: id                    |           |
      |       type: integer                |           |
      |       schema:                      |           |
      |         is_primary_key: true       |           |
      |         has_auto_increment: true   |           |
      |     - field: owner                 |           |
      |       type: integer                |           |
      |       schema: {}                   |           |
      |       meta: {}                     |           |
      | method: POST                       | code: 200 |+
      | path: /relations                   |           |
      | payload:                           |           |
      |   collection: delete_item          |           |
      |   field: owner                     |           |
      |   related_collection: delete_owner |           |
      |   meta:                            |           |
      |     one_field: owned_items         |           |
      | method: POST                       | code: 200 |+
      | path: /fields/delete_owner         |           |
      | payload:                           |           |
      |   field: owned_items               |           |
      |   type: alias                      |           |
      |   meta:                            |           |
      |     special:                       |           |
      |       - o2m                        |           |
      |     interface: list-o2m            |           |
    Then these requests get these responses:
      | request                                | response   |
      | method: DELETE                         | code: 204  |+
      | path: /relations/delete_item/owner     |            |
      | method: GET                            | code: 403  |+
      | path: /fields/delete_owner/owned_items |            |
      | method: GET                            | code: 200  |+
      | path: /items/delete_owner              | body:      |
      | query:                                 |   data: [] |
      |   fields:                              |            |
      |     - id                               |            |

  Scenario: renaming one_field renames the o2m alias it named
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /collections                 |           |
      | payload:                           |           |
      |   collection: rename_owner         |           |
      |   schema: {}                       |           |
      |   meta: {}                         |           |
      |   fields:                          |           |
      |     - field: id                    |           |
      |       type: integer                |           |
      |       schema:                      |           |
      |         is_primary_key: true       |           |
      |         has_auto_increment: true   |           |
      | method: POST                       | code: 200 |+
      | path: /collections                 |           |
      | payload:                           |           |
      |   collection: rename_item          |           |
      |   schema: {}                       |           |
      |   meta: {}                         |           |
      |   fields:                          |           |
      |     - field: id                    |           |
      |       type: integer                |           |
      |       schema:                      |           |
      |         is_primary_key: true       |           |
      |         has_auto_increment: true   |           |
      |     - field: owner                 |           |
      |       type: integer                |           |
      |       schema: {}                   |           |
      |       meta: {}                     |           |
      | method: POST                       | code: 200 |+
      | path: /relations                   |           |
      | payload:                           |           |
      |   collection: rename_item          |           |
      |   field: owner                     |           |
      |   related_collection: rename_owner |           |
      |   meta:                            |           |
      |     one_field: owned_items         |           |
      | method: POST                       | code: 200 |+
      | path: /fields/rename_owner         |           |
      | payload:                           |           |
      |   field: owned_items               |           |
      |   type: alias                      |           |
      |   meta:                            |           |
      |     special:                       |           |
      |       - o2m                        |           |
      |     interface: list-o2m            |           |
    Then these requests get these responses:
      | request                                | response                     |
      | method: PATCH                          | code: 200                    |+
      | path: /relations/rename_item/owner     |                              |
      | payload:                               |                              |
      |   meta:                                |                              |
      |     one_field: kept_items              |                              |
      | method: GET                            | code: 200                    |+
      | path: /fields/rename_owner/kept_items  | body:                        |
      |                                        |   data:                      |
      |                                        |     collection: rename_owner |
      |                                        |     field: kept_items        |
      |                                        |     type: alias              |
      |                                        |     meta:                    |
      |                                        |       special:               |
      |                                        |         - o2m                |
      | method: GET                            | code: 403                    |+
      | path: /fields/rename_owner/owned_items |                              |
      | method: GET                            | code: 200                    |+
      | path: /items/rename_owner              | body:                        |
      | query:                                 |   data: []                   |
      |   fields:                              |                              |
      |     - id                               |                              |
      |     - kept_items                       |                              |
