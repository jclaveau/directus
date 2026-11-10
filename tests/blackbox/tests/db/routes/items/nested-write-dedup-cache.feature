Feature: A create hook taking over nested records purges what it changed

  - A request cell is YAML: `method`, `path`, `query` and `payload`, sent to
    the scoped-cache instance as the admin.
  - A response cell states the `code`, the `cache` status a read answered
    with, and the part of the `body` it checks.
  - test_nwdc_segment scopes its cache on `discipline`, keys on an integer
    and keeps no revisions; its `name` is unique. A course links its
    segments through test_nwdc_course_segment rows, as the planner's
    student_course does; that junction scopes its cache on its `course`, as
    the planner's scopes on its student_course.
  - The `nested-write-dedup` hook extension filters test_nwdc_segment creates
    as the planner's Model does (`updateIfDuplicated`): a row repeating an
    earlier row's name and every other field answers `sameRowAs` that row, one
    sharing only the name is refused; a stored row the payload leaves
    unchanged is taken over inert through `skipPurgeFor`; a stored row whose
    `discipline` or `label` differs is updated on the mutation's transaction,
    and the discipline it was stored under declared through `purgeBy` and
    `forKey`.
  - The instance also reports the statements each request ran
    (`QUERY_AUDIT_HEADER`). The last step counts a request's statements per
    table and kind, on postgres alone (#414).

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
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 6       | directus_users           | 1      | 0      | 0      | 0      |
      | 6       | test_nwdc_course         | 1      | 1      | 0      | 0      |
      | 6       | test_nwdc_course_segment | 8      | 3      | 0      | 0      |
      | 6       | test_nwdc_segment        | 4      | 0      | 1      | 0      |

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
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 8       | directus_users           | 1      | 0      | 0      | 0      |
      | 8       | test_nwdc_course         | 1      | 1      | 0      | 0      |
      | 8       | test_nwdc_course_segment | 6      | 1      | 0      | 0      |
      | 8       | test_nwdc_segment        | 2      | 0      | 1      | 0      |

  Scenario: courses nesting one new segment with two labels keep the last
    When these requests get these responses:
      | request                                      | response           |
      | method: POST                                 | code: 200          |+
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
      |   fields: name,label                         |   data:            |
      |   filter[discipline][_eq]: d7                |     - name: cr-s1  |
      |                                              |       label: two   |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_nwdc_course         | 1      | 1      | 0      | 0      |
      | 1       | test_nwdc_course_segment | 7      | 2      | 0      | 0      |
      | 1       | test_nwdc_segment        | 4      | 1      | 1      | 0      |

  Scenario: twenty courses sharing two segments run statements per course
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwdc_segment                 |                         |
      | payload:                                       |                         |
      |   - name: cs-s1                                |                         |
      |     discipline: d9                             |                         |
      |     label: old                                 |                         |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwdc_course                  | body:                   |
      | query:                                         |   data:                 |
      |   fields: id,segments.id,segments.segment.name |     - id: cs-a          |
      | payload:                                       |       segments:         |
      |   - id: cs-a                                   |         - id: cs-a1     |
      |     segments:                                  |           segment:      |
      |       - id: cs-a1                              |             name: cs-s1 |
      |         segment:                               |         - id: cs-a2     |
      |           name: cs-s1                          |           segment:      |
      |           discipline: d9                       |             name: cs-s2 |
      |           label: old                           |     - id: cs-b          |
      |       - id: cs-a2                              |       segments:         |
      |         segment:                               |         - id: cs-b1     |
      |           name: cs-s2                          |           segment:      |
      |           discipline: d9                       |             name: cs-s1 |
      |           label: old                           |         - id: cs-b2     |
      |   - id: cs-b                                   |           segment:      |
      |     segments:                                  |             name: cs-s2 |
      |       - id: cs-b1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-b2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s2                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwdc_course                  |                         |
      | payload:                                       |                         |
      |   - id: cs-c                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-c1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-c2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-d                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-d1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-d2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-e                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-e1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-e2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-f                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-f1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-f2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-g                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-g1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-g2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-h                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-h1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-h2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-i                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-i1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-i2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-j                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-j1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-j2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-k                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-k1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-k2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-l                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-l1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-l2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-m                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-m1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-m2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-n                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-n1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-n2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-o                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-o1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-o2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-p                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-p1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-p2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-q                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-q1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-q2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-r                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-r1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-r2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-s                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-s1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-s2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-u                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-u1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-u2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-v                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-v1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-v2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |   - id: cs-w                                   |                         |
      |     segments:                                  |                         |
      |       - id: cs-w1                              |                         |
      |         segment:                               |                         |
      |           name: cs-s1                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      |       - id: cs-w2                              |                         |
      |         segment:                               |                         |
      |           name: cs-s3                          |                         |
      |           discipline: d9                       |                         |
      |           label: old                           |                         |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwdc_segment                 | body:                   |
      | query:                                         |   data:                 |
      |   filter[name][_starts_with]: cs-              |     - name: cs-s1       |
      |   fields: name                                 |     - name: cs-s2       |
      |   sort: name                                   |     - name: cs-s3       |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwdc_course_segment          | body:                   |
      | query:                                         |   meta:                 |
      |   filter[id][_starts_with]: cs-                |     filter_count: 44    |
      |   meta: filter_count                           |                         |
      |   limit: 0                                     |                         |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 2       | directus_users           | 1      | 0      | 0      | 0      |
      | 2       | test_nwdc_course         | 1      | 1      | 0      | 0      |
      | 2       | test_nwdc_course_segment | 9      | 4      | 0      | 0      |
      | 2       | test_nwdc_segment        | 6      | 1      | 0      | 0      |
      | 3       | directus_users           | 1      | 0      | 0      | 0      |
      | 3       | test_nwdc_course         | 1      | 1      | 0      | 0      |
      | 3       | test_nwdc_course_segment | 45     | 40     | 0      | 0      |
      | 3       | test_nwdc_segment        | 41     | 1      | 0      | 0      |
