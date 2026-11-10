Feature: A create hook deduplicating nested records links every row to one record

  - The planner's Model deduplicates a schedule segment a junction row nests by
    its fields alone: its create filter answers a row repeating an earlier
    row's unicity value with `sameRowAs` that row, and a row whose value is
    stored with the stored row's key (`updateIfDuplicated`). The
    `nested-write-dedup` hook extension does the same on test_nwd_segment,
    unique by `name`.
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
