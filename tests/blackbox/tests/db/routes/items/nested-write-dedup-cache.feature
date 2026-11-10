Feature: A create hook taking over nested records purges what it changed

  - A request cell is YAML: `method`, `path`, `query` and `payload`, sent to
    the scoped-cache instance as the admin.
  - A response cell states the `code`, the `cache` status a read answered
    with, and the part of the `body` it checks.
  - test_nwdc_segment scopes its cache on `discipline`, keys on an integer
    and keeps no revisions; its `name` is unique. A course links its
    segments through test_nwdc_course_segment rows, as the planner's
    student_course does.
  - The `nested-write-dedup` hook extension filters test_nwdc_segment creates
    as the planner's Model does (`updateIfDuplicated`): a row repeating an
    earlier row's name answers `sameRowAs` that row; a stored row the payload
    leaves unchanged is taken over inert through `skipPurgeFor`; a stored row
    whose `label` differs is updated on the mutation's transaction, and its
    discipline declared through `purgeBy` and `forKey`.

  Scenario: courses nesting a changed stored segment purge its discipline only
    When these requests get these responses:
      | request                                      | response           |
      | method: POST                                 | code: 200          |+
      | path: /items/test_nwdc_segment               |                    |
      | payload:                                     |                    |
      |   - name: ca-s1                              |                    |
      |     discipline: d1                           |                    |
      |     label: old                               |                    |
      |   - name: ca-s2                              |                    |
      |     discipline: d2                           |                    |
      |     label: old                               |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d1                |     - name: ca-s1  |
      |                                              |       label: old   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: HIT         |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d1                |     - name: ca-s1  |
      |                                              |       label: old   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d2                |     - name: ca-s2  |
      |                                              |       label: old   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: HIT         |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d2                |     - name: ca-s2  |
      |                                              |       label: old   |
      | method: POST                                 | code: 200          |+
      | path: /items/test_nwdc_course                |                    |
      | payload:                                     |                    |
      |   - id: ca-a                                 |                    |
      |     segments:                                |                    |
      |       - id: ca-a1                            |                    |
      |         segment:                             |                    |
      |           name: ca-s1                        |                    |
      |           discipline: d1                     |                    |
      |           label: new                         |                    |
      |       - id: ca-a2                            |                    |
      |         segment:                             |                    |
      |           name: ca-s2                        |                    |
      |           discipline: d2                     |                    |
      |           label: old                         |                    |
      |   - id: ca-b                                 |                    |
      |     segments:                                |                    |
      |       - id: ca-b1                            |                    |
      |         segment:                             |                    |
      |           name: ca-s1                        |                    |
      |           discipline: d1                     |                    |
      |           label: new                         |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d1                |     - name: ca-s1  |
      |                                              |       label: new   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: HIT         |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d2                |     - name: ca-s2  |
      |                                              |       label: old   |
