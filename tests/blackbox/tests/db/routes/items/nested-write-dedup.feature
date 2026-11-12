Feature: A create hook deduplicating nested records links every row to one record

  - The planner's Model deduplicates a schedule segment a junction row nests by
    its fields alone: its create filter answers a row repeating an earlier
    row's unicity value with `sameRowAs` that row, and a row whose value is
    stored with the stored row's key (`updateIfDuplicated`). The
    `nested-write-dedup` hook extension does the same on test_nwd_segment,
    unique by `name`.
  - The extension also filters test_nwd_course_segment creates as the
    planner's junction hooks do, for segments named `jn-…`, `dp-…`, `dq-…` or
    `js-…` only: a row repeating an earlier row's course and segment name
    answers `sameRowAs` that row; one read on the mutation's transaction, and a nested
    segment whose name is stored becomes its key; a new one stays nested, for
    the test_nwd_segment filter.
  - A course links its segments through test_nwd_course_segment rows, as the
    planner's student_course does. A segment's key is generated, so the
    responses read each segment by name.
  - Every key and name is a string the scenario chooses, all of one
    scenario's sharing a prefix of its own.
  - A Given creates its table's rows in one request. A request authenticates
    as the admin. A response cell states the keys it checks; an array still
    has to hold as many items as it states.
  - A Then reads back every row whose key starts with the prefix, sorted by
    key, with the table's columns; a row the table leaves out does not exist.
  - Every request goes to an instance of the feature's own, sharing the
    database, that reports the statements each request ran
    (`QUERY_AUDIT_HEADER`). The last step counts a request's statements per
    table and kind, on postgres alone: a nested write runs no more
    statements for twenty courses than for two (#414).

  Scenario: a course nesting a stored segment and a new one links both
    Given the rows of test_nwd_segment:
      | name  |
      | st-s1 |
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwd_course                   | body:                   |
      | query:                                         |   data:                 |
      |   fields: id,segments.id,segments.segment.name |     id: st-a            |
      | payload:                                       |     segments:           |
      |   id: st-a                                     |       - id: st-a1       |
      |   segments:                                    |         segment:        |
      |     - id: st-a1                                |           name: st-s1   |
      |       segment:                                 |       - id: st-a2       |
      |         name: st-s1                            |         segment:        |
      |     - id: st-a2                                |           name: st-s2   |
      |       segment:                                 |                         |
      |         name: st-s2                            |                         |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwd_segment                  | body:                   |
      | query:                                         |   data:                 |
      |   filter[name][_starts_with]: st-              |     - name: st-s1       |
      |   fields: name                                 |     - name: st-s2       |
      |   sort: name                                   |                         |
    Then the rows of test_nwd_course_segment whose key starts with "st-" are:
      | id    | course |
      | st-a1 | st-a   |
      | st-a2 | st-a   |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_activity       | 0      | 3      | 0      | 0      |
      | 1       | directus_revisions      | 0      | 3      | 2      | 0      |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | test_nwd_course         | 1      | 1      | 0      | 0      |
      | 1       | test_nwd_course_segment | 4      | 1      | 0      | 0      |
      | 1       | test_nwd_segment        | 2      | 1      | 0      | 0      |

  Scenario: two courses of one request sharing a stored segment link it once each
    Given the rows of test_nwd_segment:
      | name  |
      | sh-s1 |
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwd_course                   | body:                   |
      | query:                                         |   data:                 |
      |   fields: id,segments.id,segments.segment.name |     - id: sh-a          |
      | payload:                                       |       segments:         |
      |   - id: sh-a                                   |         - id: sh-a1     |
      |     segments:                                  |           segment:      |
      |       - id: sh-a1                              |             name: sh-s1 |
      |         segment:                               |     - id: sh-b          |
      |           name: sh-s1                          |       segments:         |
      |   - id: sh-b                                   |         - id: sh-b1     |
      |     segments:                                  |           segment:      |
      |       - id: sh-b1                              |             name: sh-s1 |
      |         segment:                               |                         |
      |           name: sh-s1                          |                         |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwd_segment                  | body:                   |
      | query:                                         |   data:                 |
      |   filter[name][_starts_with]: sh-              |     - name: sh-s1       |
      |   fields: name                                 |                         |
      |   sort: name                                   |                         |
    Then the rows of test_nwd_course_segment whose key starts with "sh-" are:
      | id    | course |
      | sh-a1 | sh-a   |
      | sh-b1 | sh-b   |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_activity       | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions      | 0      | 2      | 1      | 0      |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | test_nwd_course         | 1      | 1      | 0      | 0      |
      | 1       | test_nwd_course_segment | 4      | 1      | 0      | 0      |
      | 1       | test_nwd_segment        | 2      | 0      | 0      | 0      |

  Scenario: two courses of one request nesting the same new segment link one segment
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwd_course                   | body:                   |
      | query:                                         |   data:                 |
      |   fields: id,segments.id,segments.segment.name |     - id: nw-a          |
      | payload:                                       |       segments:         |
      |   - id: nw-a                                   |         - id: nw-a1     |
      |     segments:                                  |           segment:      |
      |       - id: nw-a1                              |             name: nw-s1 |
      |         segment:                               |     - id: nw-b          |
      |           name: nw-s1                          |       segments:         |
      |   - id: nw-b                                   |         - id: nw-b1     |
      |     segments:                                  |           segment:      |
      |       - id: nw-b1                              |             name: nw-s1 |
      |         segment:                               |                         |
      |           name: nw-s1                          |                         |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwd_segment                  | body:                   |
      | query:                                         |   data:                 |
      |   filter[name][_starts_with]: nw-              |     - name: nw-s1       |
      |   fields: name                                 |                         |
      |   sort: name                                   |                         |
    Then the rows of test_nwd_course_segment whose key starts with "nw-" are:
      | id    | course |
      | nw-a1 | nw-a   |
      | nw-b1 | nw-b   |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_activity       | 0      | 3      | 0      | 0      |
      | 1       | directus_revisions      | 0      | 3      | 2      | 0      |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | test_nwd_course         | 1      | 1      | 0      | 0      |
      | 1       | test_nwd_course_segment | 4      | 1      | 0      | 0      |
      | 1       | test_nwd_segment        | 2      | 1      | 0      | 0      |

  Scenario: two courses sharing a stored segment and a new one link two segments
    Given the rows of test_nwd_segment:
      | name  |
      | jn-s1 |
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwd_course                   | body:                   |
      | query:                                         |   data:                 |
      |   fields: id,segments.id,segments.segment.name |     - id: jn-a          |
      | payload:                                       |       segments:         |
      |   - id: jn-a                                   |         - id: jn-a1     |
      |     segments:                                  |           segment:      |
      |       - id: jn-a1                              |             name: jn-s1 |
      |         segment:                               |         - id: jn-a2     |
      |           name: jn-s1                          |           segment:      |
      |       - id: jn-a2                              |             name: jn-s2 |
      |         segment:                               |     - id: jn-b          |
      |           name: jn-s2                          |       segments:         |
      |   - id: jn-b                                   |         - id: jn-b1     |
      |     segments:                                  |           segment:      |
      |       - id: jn-b1                              |             name: jn-s1 |
      |         segment:                               |         - id: jn-b2     |
      |           name: jn-s1                          |           segment:      |
      |       - id: jn-b2                              |             name: jn-s2 |
      |         segment:                               |                         |
      |           name: jn-s2                          |                         |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwd_segment                  | body:                   |
      | query:                                         |   data:                 |
      |   filter[name][_starts_with]: jn-              |     - name: jn-s1       |
      |   fields: name                                 |     - name: jn-s2       |
      |   sort: name                                   |                         |
    Then the rows of test_nwd_course_segment whose key starts with "jn-" are:
      | id    | course |
      | jn-a1 | jn-a   |
      | jn-a2 | jn-a   |
      | jn-b1 | jn-b   |
      | jn-b2 | jn-b   |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_activity       | 0      | 3      | 0      | 0      |
      | 1       | directus_revisions      | 0      | 3      | 2      | 0      |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | test_nwd_course         | 1      | 1      | 0      | 0      |
      | 1       | test_nwd_course_segment | 4      | 1      | 0      | 0      |
      | 1       | test_nwd_segment        | 3      | 1      | 0      | 0      |

  Scenario: a course nesting the same new segment under two keys is refused
    When these requests get these responses:
      | request                           | response                                 |
      | method: POST                      | code: 400                                |+
      | path: /items/test_nwd_course      | body:                                    |
      | payload:                          |   errors:                                |
      |   id: dp-a                        |     - message: >-                        |
      |   segments:                       |         Invalid payload. A filter hook   |
      |     - id: dp-a1                   |         answered row 1 of                |
      |       segment:                    |         "test_nwd_course_segment" as the |
      |         name: dp-s1               |         same row as row 0, but row 1     |
      |     - id: dp-a2                   |         names the key "dp-a2" and row 0  |
      |       segment:                    |         the key "dp-a1".                 |
      |         name: dp-s1               |                                          |
      | method: GET                       | code: 200                                |+
      | path: /items/test_nwd_course      | body:                                    |
      | query:                            |   data: []                               |
      |   filter[id][_starts_with]: dp-   |                                          |
      | method: GET                       | code: 200                                |+
      | path: /items/test_nwd_segment     | body:                                    |
      | query:                            |   data: []                               |
      |   filter[name][_starts_with]: dp- |                                          |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | test_nwd_course         | 0      | 1      | 0      | 0      |
      | 1       | test_nwd_course_segment | 2      | 0      | 0      | 0      |
      | 1       | test_nwd_segment        | 1      | 0      | 0      | 0      |

  Scenario: a course nesting the same new segment twice under one key links it once
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwd_course                   | body:                   |
      | query:                                         |   data:                 |
      |   fields: id,segments.id,segments.segment.name |     id: dq-a            |
      | payload:                                       |     segments:           |
      |   id: dq-a                                     |       - id: dq-a1       |
      |   segments:                                    |         segment:        |
      |     - id: dq-a1                                |           name: dq-s1   |
      |       segment:                                 |                         |
      |         name: dq-s1                            |                         |
      |     - id: dq-a1                                |                         |
      |       segment:                                 |                         |
      |         name: dq-s1                            |                         |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwd_segment                  | body:                   |
      | query:                                         |   data:                 |
      |   filter[name][_starts_with]: dq-              |     - name: dq-s1       |
      |   fields: name                                 |                         |
      |   sort: name                                   |                         |
    Then the rows of test_nwd_course_segment whose key starts with "dq-" are:
      | id    | course |
      | dq-a1 | dq-a   |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_activity       | 0      | 4      | 0      | 0      |
      | 1       | directus_revisions      | 0      | 4      | 2      | 0      |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | test_nwd_course         | 1      | 1      | 0      | 0      |
      | 1       | test_nwd_course_segment | 6      | 1      | 1      | 0      |
      | 1       | test_nwd_segment        | 4      | 1      | 0      | 0      |

  Scenario: twenty courses sharing two segments run no more statements than two
    Given the rows of test_nwd_segment:
      | name  |
      | js-s1 |
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwd_course                   | body:                   |
      | query:                                         |   data:                 |
      |   fields: id,segments.id,segments.segment.name |     - id: js-a          |
      | payload:                                       |       segments:         |
      |   - id: js-a                                   |         - id: js-a1     |
      |     segments:                                  |           segment:      |
      |       - id: js-a1                              |             name: js-s1 |
      |         segment:                               |         - id: js-a2     |
      |           name: js-s1                          |           segment:      |
      |       - id: js-a2                              |             name: js-s2 |
      |         segment:                               |     - id: js-b          |
      |           name: js-s2                          |       segments:         |
      |   - id: js-b                                   |         - id: js-b1     |
      |     segments:                                  |           segment:      |
      |       - id: js-b1                              |             name: js-s1 |
      |         segment:                               |         - id: js-b2     |
      |           name: js-s1                          |           segment:      |
      |       - id: js-b2                              |             name: js-s2 |
      |         segment:                               |                         |
      |           name: js-s2                          |                         |
      | method: POST                                   | code: 200               |+
      | path: /items/test_nwd_course                   |                         |
      | payload:                                       |                         |
      |   - id: js-c                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-c1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-c2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-d                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-d1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-d2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-e                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-e1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-e2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-f                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-f1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-f2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-g                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-g1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-g2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-h                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-h1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-h2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-i                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-i1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-i2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-j                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-j1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-j2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-k                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-k1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-k2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-l                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-l1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-l2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-m                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-m1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-m2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-n                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-n1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-n2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-o                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-o1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-o2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-p                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-p1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-p2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-q                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-q1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-q2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-r                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-r1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-r2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-s                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-s1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-s2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-u                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-u1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-u2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-v                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-v1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-v2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      |   - id: js-w                                   |                         |
      |     segments:                                  |                         |
      |       - id: js-w1                              |                         |
      |         segment:                               |                         |
      |           name: js-s1                          |                         |
      |       - id: js-w2                              |                         |
      |         segment:                               |                         |
      |           name: js-s3                          |                         |
      | method: GET                                    | code: 200               |+
      | path: /items/test_nwd_segment                  | body:                   |
      | query:                                         |   data:                 |
      |   filter[name][_starts_with]: js-              |     - name: js-s1       |
      |   fields: name                                 |     - name: js-s2       |
      |   sort: name                                   |     - name: js-s3       |
    Then the rows of test_nwd_course_segment whose key starts with "js-" are:
      | id    | course |
      | js-a1 | js-a   |
      | js-a2 | js-a   |
      | js-b1 | js-b   |
      | js-b2 | js-b   |
      | js-c1 | js-c   |
      | js-c2 | js-c   |
      | js-d1 | js-d   |
      | js-d2 | js-d   |
      | js-e1 | js-e   |
      | js-e2 | js-e   |
      | js-f1 | js-f   |
      | js-f2 | js-f   |
      | js-g1 | js-g   |
      | js-g2 | js-g   |
      | js-h1 | js-h   |
      | js-h2 | js-h   |
      | js-i1 | js-i   |
      | js-i2 | js-i   |
      | js-j1 | js-j   |
      | js-j2 | js-j   |
      | js-k1 | js-k   |
      | js-k2 | js-k   |
      | js-l1 | js-l   |
      | js-l2 | js-l   |
      | js-m1 | js-m   |
      | js-m2 | js-m   |
      | js-n1 | js-n   |
      | js-n2 | js-n   |
      | js-o1 | js-o   |
      | js-o2 | js-o   |
      | js-p1 | js-p   |
      | js-p2 | js-p   |
      | js-q1 | js-q   |
      | js-q2 | js-q   |
      | js-r1 | js-r   |
      | js-r2 | js-r   |
      | js-s1 | js-s   |
      | js-s2 | js-s   |
      | js-u1 | js-u   |
      | js-u2 | js-u   |
      | js-v1 | js-v   |
      | js-v2 | js-v   |
      | js-w1 | js-w   |
      | js-w2 | js-w   |
    And on postgres the requests ran these statements:
      | request | table                   | select | insert | update | delete |
      | 1       | directus_activity       | 0      | 3      | 0      | 0      |
      | 1       | directus_revisions      | 0      | 3      | 2      | 0      |
      | 1       | directus_users          | 1      | 0      | 0      | 0      |
      | 1       | test_nwd_course         | 1      | 1      | 0      | 0      |
      | 1       | test_nwd_course_segment | 4      | 1      | 0      | 0      |
      | 1       | test_nwd_segment        | 3      | 1      | 0      | 0      |
      | 2       | directus_activity       | 0      | 3      | 0      | 0      |
      | 2       | directus_revisions      | 0      | 3      | 2      | 0      |
      | 2       | directus_users          | 1      | 0      | 0      | 0      |
      | 2       | test_nwd_course         | 1      | 1      | 0      | 0      |
      | 2       | test_nwd_course_segment | 4      | 1      | 0      | 0      |
      | 2       | test_nwd_segment        | 2      | 1      | 0      | 0      |
