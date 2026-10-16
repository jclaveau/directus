Feature: Schema rows without meta get their meta on the first update

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.
  - `test_wp_meta_pets.owner_id` is a many-to-one to `test_wp_meta_owners`
    with a meta row; `spare_id` beside it is a plain integer. In
    `test_wp_meta_links`, `link_id` is a plain integer no relation uses yet.
  - `test_wp_meta_bare` and `test_wp_meta_gql` do not exist before their
    scenario creates them.
  - A relation update restates its collection, field and related collection:
    the service reads the column types off the payload, and without them it
    drops the foreign key and never adds it back.
  - The collection GraphQL updates is created over REST: the update mutation
    strips `collection` and `schema` from the input type the create mutation
    shares, so GraphQL cannot create one.

  Scenario: a collection and a field created without meta get it on update
    Then these requests get these responses:
      | request                                     | response                          |
      | method: POST                                | code: 200                         |+
      | path: /collections                          | body:                             |
      | payload:                                    |   data:                           |
      |   collection: test_wp_meta_bare             |     collection: test_wp_meta_bare |
      |   schema: {}                                |     meta: null                    |
      |   meta: null                                |                                   |
      | method: PATCH                               | code: 200                         |+
      | path: /collections/test_wp_meta_bare        | body:                             |
      | payload:                                    |   data:                           |
      |   meta:                                     |     meta:                         |
      |     note: bare-<run>                        |       note: bare-<run>            |
      | method: POST                                | code: 200                         |+
      | path: /fields/test_wp_meta_bare             | body:                             |
      | payload:                                    |   data:                           |
      |   field: plain_label                        |     field: plain_label            |
      |   type: string                              |     meta: null                    |
      |   schema: {}                                |                                   |
      |   meta: null                                |                                   |
      | method: PATCH                               | code: 200                         |+
      | path: /fields/test_wp_meta_bare/plain_label | body:                             |
      | payload:                                    |   data:                           |
      |   meta:                                     |     meta:                         |
      |     note: label-<run>                       |       note: label-<run>           |
      | method: DELETE                              | code: 204                         |+
      | path: /collections/test_wp_meta_bare        |                                   |

  Scenario: a relation whose meta row moved away gets a new one on update
    Then these requests get these responses:
      | request                                     | response                          |
      | method: PATCH                               | code: 200                         |+
      | path: /relations/test_wp_meta_pets/owner_id | body:                             |
      | payload:                                    |   data:                           |
      |   collection: test_wp_meta_pets             |     field: owner_id               |
      |   field: owner_id                           |     meta: null                    |
      |   related_collection: test_wp_meta_owners   |                                   |
      |   meta:                                     |                                   |
      |     many_field: spare_id                    |                                   |
      | method: PATCH                               | code: 200                         |+
      | path: /relations/test_wp_meta_pets/owner_id | body:                             |
      | payload:                                    |   data:                           |
      |   collection: test_wp_meta_pets             |     meta:                         |
      |   field: owner_id                           |       many_field: owner_id        |
      |   related_collection: test_wp_meta_owners   |       one_deselect_action: delete |
      |   meta:                                     |                                   |
      |     one_deselect_action: delete             |                                   |

  Scenario: GraphQL updates and deletes a collection
    Given these requests are sent:
      | request                        | response  |
      | method: POST                   | code: 200 |+
      | path: /collections             |           |
      | payload:                       |           |
      |   collection: test_wp_meta_gql |           |
      |   schema: {}                   |           |
      |   meta:                        |           |
      |     note: created              |           |
    Then these requests get these responses:
      | request                                 | response                           |
      | method: POST                            | code: 200                          |+
      | path: /graphql/system                   | body:                              |
      | payload:                                |   data:                            |
      |   query: >-                             |     update_collections_item:       |
      |     mutation { update_collections_item( |       meta:                        |
      |     collection: "test_wp_meta_gql",     |         note: updated              |
      |     data: { meta: { note: "updated" } } |                                    |
      |     ) { meta { note } } }               |                                    |
      | method: POST                            | code: 200                          |+
      | path: /graphql/system                   | body:                              |
      | payload:                                |   data:                            |
      |   query: >-                             |     delete_collections_item:       |
      |     mutation { delete_collections_item( |       collection: test_wp_meta_gql |
      |     collection: "test_wp_meta_gql"      |                                    |
      |     ) { collection } }                  |                                    |

  Scenario: GraphQL creates, updates and deletes a relation
    Then these requests get these responses:
      | request                                  | response                             |
      | method: POST                             | code: 200                            |+
      | path: /graphql/system                    | body:                                |
      | payload:                                 |   data:                              |
      |   query: >-                              |     create_relations_item:           |
      |     mutation { create_relations_item(    |       collection: test_wp_meta_links |
      |     data: {                              |       field: link_id                 |
      |     collection: "test_wp_meta_links",    |                                      |
      |     field: "link_id",                    |                                      |
      |     related_collection:                  |                                      |
      |     "test_wp_meta_owners" }              |                                      |
      |     ) { collection field } }             |                                      |
      | method: POST                             | code: 200                            |+
      | path: /graphql/system                    | body:                                |
      | payload:                                 |   data:                              |
      |   query: >-                              |     update_relations_item:           |
      |     mutation { update_relations_item(    |       meta:                          |
      |     collection: "test_wp_meta_links",    |         one_deselect_action: delete  |
      |     field: "link_id",                    |                                      |
      |     data: {                              |                                      |
      |     collection: "test_wp_meta_links",    |                                      |
      |     field: "link_id",                    |                                      |
      |     meta: {                              |                                      |
      |     one_deselect_action: "delete" } }    |                                      |
      |     ) { meta { one_deselect_action } } } |                                      |
      | method: POST                             | code: 200                            |+
      | path: /graphql/system                    | body:                                |
      | payload:                                 |   data:                              |
      |   query: >-                              |     delete_relations_item:           |
      |     mutation { delete_relations_item(    |       collection: test_wp_meta_links |
      |     collection: "test_wp_meta_links",    |       field: link_id                 |
      |     field: "link_id"                     |                                      |
      |     ) { collection field } }             |                                      |
      | method: GET                              | code: 200                            |+
      | path: /relations/test_wp_meta_links      | body:                                |
      |                                          |   data: []                           |
