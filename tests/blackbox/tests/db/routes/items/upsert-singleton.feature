Feature: A singleton's PATCH creates its row once, then updates it

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list under
    `query` is sent joined by commas. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_singleton_upsert` is a singleton keyed by an auto-incremented
    integer, starts empty, and keeps its revisions.

  Scenario: the first PATCH creates the row and the next one updates it
    When these requests get these responses:
      | request                                          | response               |
      | method: PATCH                                    | code: 200              |+
      | path: /items/test_singleton_upsert               | body:                  |
      | payload:                                         |   data:                |
      |   title: first                                   |     id: 1              |
      |                                                  |     title: first       |
      | method: PATCH                                    | code: 200              |+
      | path: /items/test_singleton_upsert               | body:                  |
      | payload:                                         |   data:                |
      |   title: second                                  |     id: 1              |
      |                                                  |     title: second      |
      | method: GET                                      | code: 200              |+
      | path: /items/test_singleton_upsert               | body:                  |
      |                                                  |   data:                |
      |                                                  |     id: 1              |
      |                                                  |     title: second      |
      | method: GET                                      | code: 200              |+
      | path: /revisions                                 | body:                  |
      | query:                                           |   data:                |
      |   filter[collection][_eq]: test_singleton_upsert |     - activity:        |
      |   fields:                                        |         action: create |
      |     - activity.action                            |       item: '1'        |
      |     - item                                       |       delta:           |
      |     - delta                                      |         title: first   |
      |   sort: id                                       |     - activity:        |
      |                                                  |         action: update |
      |                                                  |       item: '1'        |
      |                                                  |       delta:           |
      |                                                  |         title: second  |
