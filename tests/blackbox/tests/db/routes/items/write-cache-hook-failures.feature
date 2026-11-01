Feature: A write failing after its hooks still purges what they wrote or declared

  - A request cell is YAML: `method`, `path`, `query`, `payload`, and
    `instance`, the scoped-cache instance unless it says `uncached`, the
    suite's own. A request authenticates as the admin.
  - A response cell states the `code`, the `cache` status a read answered
    with, and the part of the `body` it checks.
  - Every `test_wcf_*` collection but the foreign ones scopes its cache on
    `slot`; a `code` is unique. None keeps revisions.
  - `write-cache-failure-probe` runs an ItemsService write without
    accountability and answers its keys, or its failure's message.
  - The `write-cache-failure-hooks` hook acts on the body it is sent:
    - "take-over-first" on test_wcf_update_precise: writes the first row sent
      "taken-over" through the pool, takes it over, and gives the other rows
      the code "c".
    - "take-over-sibling" on test_wcf_update_coarse: writes the row in slot
      "b" "taken-over" through the pool, takes it over without declaring it,
      and gives the rows sent the code "c".
    - "declare-foreign" on test_wcf_nested_child: declares
      test_wcf_nested_foreign through `purgeBy` and gives the rows the code "b".
    - "declare-foreign" on test_wcf_nested_delete_child, a delete: declares
      test_wcf_nested_delete_foreign through `purgeBy`. A holder still
      referencing the child refuses its delete, which deselecting it from its
      parent runs.
    - "refuse-deletion" on test_wcf_delete, a delete: declares
      test_wcf_delete_foreign through `purgeBy` and cancels.
    - "take-over-declared" on test_wcf_upsert_takeover, a create: writes the
      row in slot "a" "taken-over" through the pool, takes it over, and
      declares slot "a" for its key through `purgeBy` and `forKey`.
    - "refuse-declaring-foreign" on test_wcf_upsert_declared, a create:
      declares test_wcf_upsert_foreign through `purgeBy`, then throws.
    - "refuse" on test_wcf_upsert_takeover, test_wcf_upsert_shared and
      test_wcf_upsert_uncached, a create: throws.
    - "add-sibling" on test_wcf_upsert_added: adds the row in slot "b" to the
      rows its group writes.

  Scenario: a refused update purges only the slices of the row its hook took over
    When these requests get these responses:
      | request                              | response               |
      | method: POST                         | code: 200              |+
      | path: /items/test_wcf_update_precise |                        |
      | payload:                             |                        |
      |   - id: 1                            |                        |
      |     slot: a                          |                        |
      |     body: original                   |                        |
      |     code: a                          |                        |
      |   - id: 2                            |                        |
      |     slot: b                          |                        |
      |     body: original                   |                        |
      |     code: b                          |                        |
      |   - id: 3                            |                        |
      |     slot: c                          |                        |
      |     body: bystander                  |                        |
      |     code: c                          |                        |
      | method: GET                          | code: 200              |+
      | path: /items/test_wcf_update_precise | cache: MISS            |
      | query:                               | body:                  |
      |   fields: body                       |   data:                |
      |   filter[slot][_eq]: a               |     - body: original   |
      | method: GET                          | code: 200              |+
      | path: /items/test_wcf_update_precise | cache: HIT             |
      | query:                               | body:                  |
      |   fields: body                       |   data:                |
      |   filter[slot][_eq]: a               |     - body: original   |
      | method: GET                          | code: 200              |+
      | path: /items/test_wcf_update_precise | cache: MISS            |
      | query:                               | body:                  |
      |   fields: body                       |   data:                |
      |   filter[slot][_eq]: c               |     - body: bystander  |
      | method: GET                          | code: 200              |+
      | path: /items/test_wcf_update_precise | cache: HIT             |
      | query:                               | body:                  |
      |   fields: body                       |   data:                |
      |   filter[slot][_eq]: c               |     - body: bystander  |
      | method: PATCH                        | code: 400              |+
      | path: /items/test_wcf_update_precise |                        |
      | payload:                             |                        |
      |   keys: [1, 2]                       |                        |
      |   data:                              |                        |
      |     body: take-over-first            |                        |
      | method: GET                          | code: 200              |+
      | path: /items/test_wcf_update_precise | cache: MISS            |
      | query:                               | body:                  |
      |   fields: body                       |   data:                |
      |   filter[slot][_eq]: a               |     - body: taken-over |
      | method: GET                          | code: 200              |+
      | path: /items/test_wcf_update_precise | cache: HIT             |
      | query:                               | body:                  |
      |   fields: body                       |   data:                |
      |   filter[slot][_eq]: c               |     - body: bystander  |
    Then response 6 is refused with the message:
      """
      Value "c" for field "code" in collection "test_wcf_update_precise" has to be unique.
      """

  Scenario: a refused update purges the collection whole for an undeclared takeover
    When these requests get these responses:
      | request                               | response               |
      | method: POST                          | code: 200              |+
      | path: /items/test_wcf_update_coarse   |                        |
      | payload:                              |                        |
      |   - id: 1                             |                        |
      |     slot: a                           |                        |
      |     body: original                    |                        |
      |     code: a                           |                        |
      |   - id: 2                             |                        |
      |     slot: b                           |                        |
      |     body: sibling                     |                        |
      |     code: b                           |                        |
      |   - id: 3                             |                        |
      |     slot: c                           |                        |
      |     body: bystander                   |                        |
      |     code: c                           |                        |
      | method: GET                           | code: 200              |+
      | path: /items/test_wcf_update_coarse   | cache: MISS            |
      | query:                                | body:                  |
      |   fields: body                        |   data:                |
      |   filter[slot][_eq]: b                |     - body: sibling    |
      | method: GET                           | code: 200              |+
      | path: /items/test_wcf_update_coarse   | cache: HIT             |
      | query:                                | body:                  |
      |   fields: body                        |   data:                |
      |   filter[slot][_eq]: b                |     - body: sibling    |
      | method: GET                           | code: 200              |+
      | path: /items/test_wcf_update_coarse   | cache: MISS            |
      | query:                                | body:                  |
      |   fields: body                        |   data:                |
      |   filter[slot][_eq]: c                |     - body: bystander  |
      | method: GET                           | code: 200              |+
      | path: /items/test_wcf_update_coarse   | cache: HIT             |
      | query:                                | body:                  |
      |   fields: body                        |   data:                |
      |   filter[slot][_eq]: c                |     - body: bystander  |
      | method: PATCH                         | code: 400              |+
      | path: /items/test_wcf_update_coarse/1 |                        |
      | payload:                              |                        |
      |   body: take-over-sibling             |                        |
      | method: GET                           | code: 200              |+
      | path: /items/test_wcf_update_coarse   | cache: MISS            |
      | query:                                | body:                  |
      |   fields: body                        |   data:                |
      |   filter[slot][_eq]: b                |     - body: taken-over |
      | method: GET                           | code: 200              |+
      | path: /items/test_wcf_update_coarse   | cache: MISS            |
      | query:                                | body:                  |
      |   fields: body                        |   data:                |
      |   filter[slot][_eq]: c                |     - body: bystander  |
    Then response 6 is refused with the message:
      """
      Value "c" for field "code" in collection "test_wcf_update_coarse" has to be unique.
      """

  Scenario: a refused nested update purges what its hook declared, not its rows
    When these requests get these responses:
      | request                               | response             |
      | method: POST                          | code: 200            |+
      | path: /items/test_wcf_nested_parent   |                      |
      | payload:                              |                      |
      |   id: 1                               |                      |
      |   title: parent                       |                      |
      | method: POST                          | code: 200            |+
      | path: /items/test_wcf_nested_child    |                      |
      | payload:                              |                      |
      |   - id: 1                             |                      |
      |     slot: a                           |                      |
      |     body: original                    |                      |
      |     code: a                           |                      |
      |     parent: 1                         |                      |
      |   - id: 2                             |                      |
      |     slot: b                           |                      |
      |     body: original                    |                      |
      |     code: b                           |                      |
      | method: POST                          | code: 200            |+
      | path: /items/test_wcf_nested_foreign  |                      |
      | payload:                              |                      |
      |   id: 1                               |                      |
      |   body: original                      |                      |
      | method: GET                           | code: 200            |+
      | path: /items/test_wcf_nested_child    | cache: MISS          |
      | query:                                | body:                |
      |   fields: body                        |   data:              |
      |   filter[slot][_eq]: a                |     - body: original |
      | method: GET                           | code: 200            |+
      | path: /items/test_wcf_nested_child    | cache: HIT           |
      | query:                                | body:                |
      |   fields: body                        |   data:              |
      |   filter[slot][_eq]: a                |     - body: original |
      | method: GET                           | code: 200            |+
      | path: /items/test_wcf_nested_foreign  | cache: MISS          |
      | query:                                | body:                |
      |   fields: body                        |   data:              |
      |                                       |     - body: original |
      | method: GET                           | code: 200            |+
      | path: /items/test_wcf_nested_foreign  | cache: HIT           |
      | query:                                | body:                |
      |   fields: body                        |   data:              |
      |                                       |     - body: original |
      | method: PATCH                         | code: 400            |+
      | path: /items/test_wcf_nested_parent/1 |                      |
      | payload:                              |                      |
      |   children:                           |                      |
      |     update:                           |                      |
      |       - id: 1                         |                      |
      |         body: declare-foreign         |                      |
      | method: GET                           | code: 200            |+
      | path: /items/test_wcf_nested_child    | cache: HIT           |
      | query:                                | body:                |
      |   fields: body                        |   data:              |
      |   filter[slot][_eq]: a                |     - body: original |
      | method: GET                           | code: 200            |+
      | path: /items/test_wcf_nested_foreign  | cache: MISS          |
      | query:                                | body:                |
      |   fields: body                        |   data:              |
      |                                       |     - body: original |
    Then response 8 is refused with the message:
      """
      Value "b" for field "code" in collection "test_wcf_nested_child" has to be unique.
      """

  Scenario: a refused nested delete purges what its hook declared
    When these requests get these responses:
      | request                                      | response             |
      | method: POST                                 | code: 200            |+
      | path: /items/test_wcf_nested_delete_parent   |                      |
      | payload:                                     |                      |
      |   id: 1                                      |                      |
      |   title: parent                              |                      |
      | method: POST                                 | code: 200            |+
      | path: /items/test_wcf_nested_delete_child    |                      |
      | payload:                                     |                      |
      |   id: 1                                      |                      |
      |   body: declare-foreign                      |                      |
      |   parent: 1                                  |                      |
      | method: POST                                 | code: 200            |+
      | path: /items/test_wcf_nested_delete_holder   |                      |
      | payload:                                     |                      |
      |   id: 1                                      |                      |
      |   child: 1                                   |                      |
      | method: POST                                 | code: 200            |+
      | path: /items/test_wcf_nested_delete_foreign  |                      |
      | payload:                                     |                      |
      |   id: 1                                      |                      |
      |   body: original                             |                      |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_nested_delete_foreign  | cache: MISS          |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |                                              |     - body: original |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_nested_delete_foreign  | cache: HIT           |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |                                              |     - body: original |
      | method: PATCH                                | code: 400            |+
      | path: /items/test_wcf_nested_delete_parent/1 |                      |
      | payload:                                     |                      |
      |   children:                                  |                      |
      |     delete:                                  |                      |
      |       - 1                                    |                      |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_nested_delete_foreign  | cache: MISS          |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |                                              |     - body: original |
    Then response 7 is refused with the message:
      """
      Cannot delete "test_wcf_nested_delete_child:1": it is still referenced by
      collection "test_wcf_nested_delete_holder".
      """

  Scenario: a delete its hook cancels is refused, purging what the hook declared
    When these requests get these responses:
      | request                                      | response                    |
      | method: POST                                 | code: 200                   |+
      | path: /items/test_wcf_delete                 |                             |
      | payload:                                     |                             |
      |   id: 1                                      |                             |
      |   slot: a                                    |                             |
      |   body: refuse-deletion                      |                             |
      | method: POST                                 | code: 200                   |+
      | path: /items/test_wcf_delete_foreign         |                             |
      | payload:                                     |                             |
      |   id: 1                                      |                             |
      |   body: original                             |                             |
      | method: GET                                  | code: 200                   |+
      | path: /items/test_wcf_delete                 | cache: MISS                 |
      | query:                                       | body:                       |
      |   fields: body                               |   data:                     |
      |   filter[slot][_eq]: a                       |     - body: refuse-deletion |
      | method: GET                                  | code: 200                   |+
      | path: /items/test_wcf_delete                 | cache: HIT                  |
      | query:                                       | body:                       |
      |   fields: body                               |   data:                     |
      |   filter[slot][_eq]: a                       |     - body: refuse-deletion |
      | method: GET                                  | code: 200                   |+
      | path: /items/test_wcf_delete_foreign         | cache: MISS                 |
      | query:                                       | body:                       |
      |   fields: body                               |   data:                     |
      |                                              |     - body: original        |
      | method: GET                                  | code: 200                   |+
      | path: /items/test_wcf_delete_foreign         | cache: HIT                  |
      | query:                                       | body:                       |
      |   fields: body                               |   data:                     |
      |                                              |     - body: original        |
      | method: POST                                 | code: 400                   |+
      | path: /write-cache-failure-probe/delete-many |                             |
      | payload:                                     |                             |
      |   collection: test_wcf_delete                |                             |
      |   keys: [1]                                  |                             |
      | method: GET                                  | code: 200                   |+
      | path: /items/test_wcf_delete                 | cache: HIT                  |
      | query:                                       | body:                       |
      |   fields: body                               |   data:                     |
      |   filter[slot][_eq]: a                       |     - body: refuse-deletion |
      | method: GET                                  | code: 200                   |+
      | path: /items/test_wcf_delete_foreign         | cache: MISS                 |
      | query:                                       | body:                       |
      |   fields: body                               |   data:                     |
      |                                              |     - body: original        |
      | method: POST                                 | code: 400                   |+
      | path: /write-cache-failure-probe/delete-many |                             |
      | instance: uncached                           |                             |
      | payload:                                     |                             |
      |   collection: test_wcf_delete                |                             |
      |   keys: [1]                                  |                             |
    Then responses 7 and 10 are refused by the probe with the message:
      """
      Invalid payload. A filter hook cancelled the deletion, but this operation requires
      it.
      """

  Scenario: a failed upsert purges the slice its hook declared for the row it took over
    When these requests get these responses:
      | request                                      | response               |
      | method: POST                                 | code: 200              |+
      | path: /items/test_wcf_upsert_takeover        |                        |
      | payload:                                     |                        |
      |   - id: 1                                    |                        |
      |     slot: a                                  |                        |
      |     body: original                           |                        |
      |   - id: 2                                    |                        |
      |     slot: c                                  |                        |
      |     body: bystander                          |                        |
      | method: GET                                  | code: 200              |+
      | path: /items/test_wcf_upsert_takeover        | cache: MISS            |
      | query:                                       | body:                  |
      |   fields: body                               |   data:                |
      |   filter[slot][_eq]: a                       |     - body: original   |
      | method: GET                                  | code: 200              |+
      | path: /items/test_wcf_upsert_takeover        | cache: HIT             |
      | query:                                       | body:                  |
      |   fields: body                               |   data:                |
      |   filter[slot][_eq]: a                       |     - body: original   |
      | method: GET                                  | code: 200              |+
      | path: /items/test_wcf_upsert_takeover        | cache: MISS            |
      | query:                                       | body:                  |
      |   fields: body                               |   data:                |
      |   filter[slot][_eq]: c                       |     - body: bystander  |
      | method: GET                                  | code: 200              |+
      | path: /items/test_wcf_upsert_takeover        | cache: HIT             |
      | query:                                       | body:                  |
      |   fields: body                               |   data:                |
      |   filter[slot][_eq]: c                       |     - body: bystander  |
      | method: POST                                 | code: 500              |+
      | path: /write-cache-failure-probe/upsert-many |                        |
      | payload:                                     |                        |
      |   collection: test_wcf_upsert_takeover       |                        |
      |   payloads:                                  |                        |
      |     - body: take-over-declared               |                        |
      |     - body: refuse                           |                        |
      | method: GET                                  | code: 200              |+
      | path: /items/test_wcf_upsert_takeover        | cache: MISS            |
      | query:                                       | body:                  |
      |   fields: body                               |   data:                |
      |   filter[slot][_eq]: a                       |     - body: taken-over |
      | method: GET                                  | code: 200              |+
      | path: /items/test_wcf_upsert_takeover        | cache: HIT             |
      | query:                                       | body:                  |
      |   fields: body                               |   data:                |
      |   filter[slot][_eq]: c                       |     - body: bystander  |
    Then response 6 is refused by the probe with the message:
      """
      The body "refuse" is refused
      """

  Scenario: a failed upsert taking nothing over purges only what its hook declared
    When these requests get these responses:
      | request                                      | response             |
      | method: POST                                 | code: 200            |+
      | path: /items/test_wcf_upsert_declared        |                      |
      | payload:                                     |                      |
      |   id: 1                                      |                      |
      |   slot: a                                    |                      |
      |   body: original                             |                      |
      | method: POST                                 | code: 200            |+
      | path: /items/test_wcf_upsert_foreign         |                      |
      | payload:                                     |                      |
      |   id: 1                                      |                      |
      |   body: original                             |                      |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_upsert_declared        | cache: MISS          |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |   filter[slot][_eq]: a                       |     - body: original |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_upsert_declared        | cache: HIT           |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |   filter[slot][_eq]: a                       |     - body: original |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_upsert_foreign         | cache: MISS          |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |                                              |     - body: original |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_upsert_foreign         | cache: HIT           |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |                                              |     - body: original |
      | method: POST                                 | code: 500            |+
      | path: /write-cache-failure-probe/upsert-many |                      |
      | payload:                                     |                      |
      |   collection: test_wcf_upsert_declared       |                      |
      |   payloads:                                  |                      |
      |     - body: refuse-declaring-foreign         |                      |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_upsert_declared        | cache: HIT           |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |   filter[slot][_eq]: a                       |     - body: original |
      | method: GET                                  | code: 200            |+
      | path: /items/test_wcf_upsert_foreign         | cache: MISS          |
      | query:                                       | body:                |
      |   fields: body                               |   data:              |
      |                                              |     - body: original |
    Then response 7 is refused by the probe with the message:
      """
      The body "refuse-declaring-foreign" is refused
      """

  Scenario: an upsert failing on a transaction it shares purges the collection whole
    When these requests get these responses:
      | request                                             | response              |
      | method: POST                                        | code: 200             |+
      | path: /items/test_wcf_upsert_shared                 |                       |
      | payload:                                            |                       |
      |   - id: 1                                           |                       |
      |     slot: a                                         |                       |
      |     body: original                                  |                       |
      |   - id: 2                                           |                       |
      |     slot: c                                         |                       |
      |     body: bystander                                 |                       |
      | method: GET                                         | code: 200             |+
      | path: /items/test_wcf_upsert_shared                 | cache: MISS           |
      | query:                                              | body:                 |
      |   fields: body                                      |   data:               |
      |   filter[slot][_eq]: a                              |     - body: original  |
      | method: GET                                         | code: 200             |+
      | path: /items/test_wcf_upsert_shared                 | cache: HIT            |
      | query:                                              | body:                 |
      |   fields: body                                      |   data:               |
      |   filter[slot][_eq]: a                              |     - body: original  |
      | method: GET                                         | code: 200             |+
      | path: /items/test_wcf_upsert_shared                 | cache: MISS           |
      | query:                                              | body:                 |
      |   fields: body                                      |   data:               |
      |   filter[slot][_eq]: c                              |     - body: bystander |
      | method: GET                                         | code: 200             |+
      | path: /items/test_wcf_upsert_shared                 | cache: HIT            |
      | query:                                              | body:                 |
      |   fields: body                                      |   data:               |
      |   filter[slot][_eq]: c                              |     - body: bystander |
      | method: POST                                        | code: 500             |+
      | path: /write-cache-failure-probe/upsert-many-shared |                       |
      | payload:                                            |                       |
      |   collection: test_wcf_upsert_shared                |                       |
      |   payloads:                                         |                       |
      |     - id: 1                                         |                       |
      |       body: upserted                                |                       |
      |     - body: refuse                                  |                       |
      | method: GET                                         | code: 200             |+
      | path: /items/test_wcf_upsert_shared                 | cache: MISS           |
      | query:                                              | body:                 |
      |   fields: body                                      |   data:               |
      |   filter[slot][_eq]: a                              |     - body: upserted  |
      | method: GET                                         | code: 200             |+
      | path: /items/test_wcf_upsert_shared                 | cache: MISS           |
      | query:                                              | body:                 |
      |   fields: body                                      |   data:               |
      |   filter[slot][_eq]: c                              |     - body: bystander |
    Then response 6 is refused by the probe with the message:
      """
      The body "refuse" is refused
      """

  Scenario: an upsert failing on an instance without a cache purges nothing
    When these requests get these responses:
      | request                                      | response  |
      | method: POST                                 | code: 500 |+
      | path: /write-cache-failure-probe/upsert-many |           |
      | instance: uncached                           |           |
      | payload:                                     |           |
      |   collection: test_wcf_upsert_uncached       |           |
      |   payloads:                                  |           |
      |     - body: refuse                           |           |
    Then response 1 is refused by the probe with the message:
      """
      The body "refuse" is refused
      """

  Scenario: an upsert purges the slice of a row its update hook added to a group
    When these requests get these responses:
      | request                                      | response                |
      | method: POST                                 | code: 200               |+
      | path: /items/test_wcf_upsert_added           |                         |
      | payload:                                     |                         |
      |   - id: 1                                    |                         |
      |     slot: a                                  |                         |
      |     body: original                           |                         |
      |   - id: 2                                    |                         |
      |     slot: b                                  |                         |
      |     body: sibling                            |                         |
      |   - id: 3                                    |                         |
      |     slot: c                                  |                         |
      |     body: bystander                          |                         |
      | method: GET                                  | code: 200               |+
      | path: /items/test_wcf_upsert_added           | cache: MISS             |
      | query:                                       | body:                   |
      |   fields: body                               |   data:                 |
      |   filter[slot][_eq]: b                       |     - body: sibling     |
      | method: GET                                  | code: 200               |+
      | path: /items/test_wcf_upsert_added           | cache: HIT              |
      | query:                                       | body:                   |
      |   fields: body                               |   data:                 |
      |   filter[slot][_eq]: b                       |     - body: sibling     |
      | method: GET                                  | code: 200               |+
      | path: /items/test_wcf_upsert_added           | cache: MISS             |
      | query:                                       | body:                   |
      |   fields: body                               |   data:                 |
      |   filter[slot][_eq]: c                       |     - body: bystander   |
      | method: GET                                  | code: 200               |+
      | path: /items/test_wcf_upsert_added           | cache: HIT              |
      | query:                                       | body:                   |
      |   fields: body                               |   data:                 |
      |   filter[slot][_eq]: c                       |     - body: bystander   |
      | method: POST                                 | code: 200               |+
      | path: /write-cache-failure-probe/upsert-many |                         |
      | payload:                                     |                         |
      |   collection: test_wcf_upsert_added          |                         |
      |   payloads:                                  |                         |
      |     - id: 1                                  |                         |
      |       body: add-sibling                      |                         |
      | method: GET                                  | code: 200               |+
      | path: /items/test_wcf_upsert_added           | cache: MISS             |
      | query:                                       | body:                   |
      |   fields: body                               |   data:                 |
      |   filter[slot][_eq]: b                       |     - body: add-sibling |
      | method: GET                                  | code: 200               |+
      | path: /items/test_wcf_upsert_added           | cache: HIT              |
      | query:                                       | body:                   |
      |   fields: body                               |   data:                 |
      |   filter[slot][_eq]: c                       |     - body: bystander   |
