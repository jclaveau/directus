Feature: An applied schema diff updates and deletes a relation

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.
  - `test_wp_diff_pets.owner_id` is a many-to-one to `test_wp_diff_owners`,
    its meta deselect action left at `nullify`. `vet_id` beside it is
    another many-to-one to `test_wp_diff_owners`.
  - A diff applies only under the hash of the schema it was taken from: the
    hash is read off a forced diff against an empty snapshot, and the diff
    sent is written by hand.
  - `retry_stale_hash: <name>` re-sends the diff that remembered `<name>` and
    the row again when another file moved the schema in between, up to 3
    times.

  Scenario: a diff under a stale hash that edits a relation is refused
    Then these requests get these responses:
      | request                               | response                               |
      | method: POST                          | code: 400                              |+
      | path: /schema/apply                   | body:                                  |
      | payload:                              |   errors:                              |
      |   hash: stale-<run>                   |     - message: >-                      |
      |   diff:                               |         Invalid payload. Provided hash |
      |     collections: []                   |         does not match the current     |
      |     fields: []                        |         instance's schema hash,        |
      |     relations:                        |         indicating the schema has      |
      |       - collection: test_wp_diff_pets |         changed after this diff was    |
      |         field: owner_id               |         generated. Please generate a   |
      |         diff:                         |         new diff and try again.        |
      |           - kind: E                   |                                        |
      |             path:                     |                                        |
      |               - meta                  |                                        |
      |               - one_deselect_action   |                                        |
      |             lhs: nullify              |                                        |
      |             rhs: delete               |                                        |

  Scenario: a diff edits a relation's meta, then another deletes the relation
    Then these requests get these responses:
      | request                                     | response                          |
      | method: POST                                | code: 200                         |+
      | path: /schema/diff                          |                                   |
      | query:                                      |                                   |
      |   force: 'true'                             |                                   |
      | payload:                                    |                                   |
      |   version: 1                                |                                   |
      |   directus: '0'                             |                                   |
      |   collections: []                           |                                   |
      |   fields: []                                |                                   |
      |   relations: []                             |                                   |
      | remember:                                   |                                   |
      |   edit_hash: body.data.hash                 |                                   |
      | method: POST                                | code: 204                         |+
      | path: /schema/apply                         |                                   |
      | retry_stale_hash: edit_hash                 |                                   |
      | payload:                                    |                                   |
      |   hash: <edit_hash>                         |                                   |
      |   diff:                                     |                                   |
      |     collections: []                         |                                   |
      |     fields: []                              |                                   |
      |     relations:                              |                                   |
      |       - collection: test_wp_diff_pets       |                                   |
      |         field: owner_id                     |                                   |
      |         diff:                               |                                   |
      |           - kind: E                         |                                   |
      |             path:                           |                                   |
      |               - meta                        |                                   |
      |               - one_deselect_action         |                                   |
      |             lhs: nullify                    |                                   |
      |             rhs: delete                     |                                   |
      | method: GET                                 | code: 200                         |+
      | path: /relations/test_wp_diff_pets/owner_id | body:                             |
      |                                             |   data:                           |
      |                                             |     meta:                         |
      |                                             |       one_deselect_action: delete |
      | method: POST                                | code: 200                         |+
      | path: /schema/diff                          |                                   |
      | query:                                      |                                   |
      |   force: 'true'                             |                                   |
      | payload:                                    |                                   |
      |   version: 1                                |                                   |
      |   directus: '0'                             |                                   |
      |   collections: []                           |                                   |
      |   fields: []                                |                                   |
      |   relations: []                             |                                   |
      | remember:                                   |                                   |
      |   delete_hash: body.data.hash               |                                   |
      | method: POST                                | code: 204                         |+
      | path: /schema/apply                         |                                   |
      | retry_stale_hash: delete_hash               |                                   |
      | payload:                                    |                                   |
      |   hash: <delete_hash>                       |                                   |
      |   diff:                                     |                                   |
      |     collections: []                         |                                   |
      |     fields: []                              |                                   |
      |     relations:                              |                                   |
      |       - collection: test_wp_diff_pets       |                                   |
      |         field: owner_id                     |                                   |
      |         diff:                               |                                   |
      |           - kind: D                         |                                   |
      |             lhs:                            |                                   |
      |               collection: test_wp_diff_pets |                                   |
      |               field: owner_id               |                                   |
      | method: GET                                 | code: 403                         |+
      | path: /relations/test_wp_diff_pets/owner_id | body:                             |
      |                                             |   errors:                         |
      |                                             |     - message: "No result         |
      |                                             |         found for relation        |
      |                                             |         test_wp_diff_\\           |
      |                                             |         pets.owner_id during      |
      |                                             |         items.readOne()"          |

  Scenario: a diff whose first entry drops a meta key edits the relation
    Then these requests get these responses:
      | request                                   | response                          |
      | method: POST                              | code: 200                         |+
      | path: /schema/diff                        |                                   |
      | query:                                    |                                   |
      |   force: 'true'                           |                                   |
      | payload:                                  |                                   |
      |   version: 1                              |                                   |
      |   directus: '0'                           |                                   |
      |   collections: []                         |                                   |
      |   fields: []                              |                                   |
      |   relations: []                           |                                   |
      | remember:                                 |                                   |
      |   vet_hash: body.data.hash                |                                   |
      | method: POST                              | code: 204                         |+
      | path: /schema/apply                       |                                   |
      | retry_stale_hash: vet_hash                |                                   |
      | payload:                                  |                                   |
      |   hash: <vet_hash>                        |                                   |
      |   diff:                                   |                                   |
      |     collections: []                       |                                   |
      |     fields: []                            |                                   |
      |     relations:                            |                                   |
      |       - collection: test_wp_diff_pets     |                                   |
      |         field: vet_id                     |                                   |
      |         diff:                             |                                   |
      |           - kind: D                       |                                   |
      |             path:                         |                                   |
      |               - meta                      |                                   |
      |               - sort_field                |                                   |
      |             lhs: null                     |                                   |
      |           - kind: E                       |                                   |
      |             path:                         |                                   |
      |               - meta                      |                                   |
      |               - one_deselect_action       |                                   |
      |             lhs: nullify                  |                                   |
      |             rhs: delete                   |                                   |
      | method: GET                               | code: 200                         |+
      | path: /relations/test_wp_diff_pets/vet_id | body:                             |
      |                                           |   data:                           |
      |                                           |     schema:                       |
      |                                           |       foreign_key_table: >-       |
      |                                           |         test_wp_diff_owners       |
      |                                           |     meta:                         |
      |                                           |       one_deselect_action: delete |
