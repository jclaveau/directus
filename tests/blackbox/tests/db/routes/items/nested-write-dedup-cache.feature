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
    earlier row's name and every other field answers `sameRowAs` that row, one
    sharing only the name is refused; a stored row the payload leaves
    unchanged is taken over inert through `skipPurgeFor`; a stored row whose
    `discipline` or `label` differs is updated on the mutation's transaction,
    and the discipline it was stored under declared through `purgeBy` and
    `forKey`.

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

  Scenario: a course moving a stored segment purges the discipline it left
    When these requests get these responses:
      | request                                      | response           |
      | method: POST                                 | code: 200          |+
      | path: /items/test_nwdc_segment               |                    |
      | payload:                                     |                    |
      |   - name: cm-s1                              |                    |
      |     discipline: d4                           |                    |
      |     label: old                               |                    |
      |   - name: cm-s2                              |                    |
      |     discipline: d6                           |                    |
      |     label: old                               |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d4                |     - name: cm-s1  |
      |                                              |       label: old   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: HIT         |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d4                |     - name: cm-s1  |
      |                                              |       label: old   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data: []         |
      |   filter[discipline][_eq]: d5                |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: HIT         |
      | query:                                       | body:              |
      |   fields: name,label                         |   data: []         |
      |   filter[discipline][_eq]: d5                |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d6                |     - name: cm-s2  |
      |                                              |       label: old   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: HIT         |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d6                |     - name: cm-s2  |
      |                                              |       label: old   |
      | method: POST                                 | code: 200          |+
      | path: /items/test_nwdc_course                |                    |
      | payload:                                     |                    |
      |   - id: cm-a                                 |                    |
      |     segments:                                |                    |
      |       - id: cm-a1                            |                    |
      |         segment:                             |                    |
      |           name: cm-s1                        |                    |
      |           discipline: d5                     |                    |
      |           label: old                         |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data: []         |
      |   filter[discipline][_eq]: d4                |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d5                |     - name: cm-s1  |
      |                                              |       label: old   |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: HIT         |
      | query:                                       | body:              |
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d6                |     - name: cm-s2  |
      |                                              |       label: old   |

  Scenario: courses nesting one new segment with two labels are refused
    When these requests get these responses:
      | request                                      | response           |
      | method: POST                                 | code: 400          |+
      | path: /items/test_nwdc_course                |                    |
      | payload:                                     |                    |
      |   - id: cr-a                                 |                    |
      |     segments:                                |                    |
      |       - id: cr-a1                            |                    |
      |         segment:                             |                    |
      |           name: cr-s1                        |                    |
      |           discipline: d7                     |                    |
      |           label: one                         |                    |
      |   - id: cr-b                                 |                    |
      |     segments:                                |                    |
      |       - id: cr-b1                            |                    |
      |         segment:                             |                    |
      |           name: cr-s1                        |                    |
      |           discipline: d7                     |                    |
      |           label: two                         |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_nwdc_segment               | cache: MISS        |
      | query:                                       | body:              |
      |   fields: name,label                         |   data: []         |
      |   filter[discipline][_eq]: d7                |                    |
    Then response 1 is refused with the message:
      """
      Value "cr-s1" for field "name" in collection "test_nwdc_segment" has to be
      unique.
      """
