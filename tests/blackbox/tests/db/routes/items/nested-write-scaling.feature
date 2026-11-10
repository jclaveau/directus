Feature: A nested write runs the statements of two parents for twenty

  - The planner creates a batch of parents together with their children; #414
    batched those nested writes so their statements no longer grow with the
    batch. Each scenario sends the same nested create twice, first with two
    parents, then with twenty, and holds both requests to the same counts.
  - Every child collection is scoped through its parent (`scoped_cache_fields`
    on a relational path), as the planner's are, so the purge's scope reads
    are counted too. Activity and revisions are kept, which the planner's
    `student_*` collections turn off, so their counts show the core's cost.
  - Every key is a string the scenario chooses, all of one scenario's keys
    sharing a prefix of its own. Parent letters skip `t`, the many-to-many
    scenario's tags. A label's key is generated: a book names its new label
    by its fields alone, as a planner junction row names its schedule
    segment, so a Then leaves the labels out.
  - A Given creates its table's rows in one request. A request authenticates
    as the admin. A response cell states the keys it checks.
  - A Then reads back every row whose key starts with the prefix, sorted by
    key, with the table's columns; a row the table leaves out does not exist.
  - Every request goes to an instance of the feature's own, sharing the
    database, with the scoped cache on, that reports the statements each
    request ran (`QUERY_AUDIT_HEADER`). The last step counts a request's
    statements per table and kind, on postgres alone.
  - The children's revisions of every created parent are linked to their
    parent's revision in one update on `directus_revisions`, whatever the
    number of parents (#414).

  Scenario: a one-to-many create of twenty parents runs the statements of two
    When these requests get these responses:
      | request                    | response  |
      | method: POST               | code: 200 |+
      | path: /items/test_nws_deck |           |
      | payload:                   |           |
      |   - id: os-a               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-a1          |           |
      |       - id: os-a2          |           |
      |   - id: os-b               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-b1          |           |
      |       - id: os-b2          |           |
      | method: POST               | code: 200 |+
      | path: /items/test_nws_deck |           |
      | payload:                   |           |
      |   - id: os-c               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-c1          |           |
      |       - id: os-c2          |           |
      |   - id: os-d               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-d1          |           |
      |       - id: os-d2          |           |
      |   - id: os-e               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-e1          |           |
      |       - id: os-e2          |           |
      |   - id: os-f               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-f1          |           |
      |       - id: os-f2          |           |
      |   - id: os-g               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-g1          |           |
      |       - id: os-g2          |           |
      |   - id: os-h               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-h1          |           |
      |       - id: os-h2          |           |
      |   - id: os-i               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-i1          |           |
      |       - id: os-i2          |           |
      |   - id: os-j               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-j1          |           |
      |       - id: os-j2          |           |
      |   - id: os-k               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-k1          |           |
      |       - id: os-k2          |           |
      |   - id: os-l               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-l1          |           |
      |       - id: os-l2          |           |
      |   - id: os-m               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-m1          |           |
      |       - id: os-m2          |           |
      |   - id: os-n               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-n1          |           |
      |       - id: os-n2          |           |
      |   - id: os-o               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-o1          |           |
      |       - id: os-o2          |           |
      |   - id: os-p               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-p1          |           |
      |       - id: os-p2          |           |
      |   - id: os-q               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-q1          |           |
      |       - id: os-q2          |           |
      |   - id: os-r               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-r1          |           |
      |       - id: os-r2          |           |
      |   - id: os-s               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-s1          |           |
      |       - id: os-s2          |           |
      |   - id: os-u               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-u1          |           |
      |       - id: os-u2          |           |
      |   - id: os-v               |           |
      |     owner: u1              |           |
      |     cards:                 |           |
      |       - id: os-v1          |           |
      |       - id: os-v2          |           |
      |   - id: os-w               |           |
      |     owner: u2              |           |
      |     cards:                 |           |
      |       - id: os-w1          |           |
      |       - id: os-w2          |           |
    Then the rows of test_nws_card whose key starts with "os-" are:
      | id    | deck |
      | os-a1 | os-a |
      | os-a2 | os-a |
      | os-b1 | os-b |
      | os-b2 | os-b |
      | os-c1 | os-c |
      | os-c2 | os-c |
      | os-d1 | os-d |
      | os-d2 | os-d |
      | os-e1 | os-e |
      | os-e2 | os-e |
      | os-f1 | os-f |
      | os-f2 | os-f |
      | os-g1 | os-g |
      | os-g2 | os-g |
      | os-h1 | os-h |
      | os-h2 | os-h |
      | os-i1 | os-i |
      | os-i2 | os-i |
      | os-j1 | os-j |
      | os-j2 | os-j |
      | os-k1 | os-k |
      | os-k2 | os-k |
      | os-l1 | os-l |
      | os-l2 | os-l |
      | os-m1 | os-m |
      | os-m2 | os-m |
      | os-n1 | os-n |
      | os-n2 | os-n |
      | os-o1 | os-o |
      | os-o2 | os-o |
      | os-p1 | os-p |
      | os-p2 | os-p |
      | os-q1 | os-q |
      | os-q2 | os-q |
      | os-r1 | os-r |
      | os-r2 | os-r |
      | os-s1 | os-s |
      | os-s2 | os-s |
      | os-u1 | os-u |
      | os-u2 | os-u |
      | os-v1 | os-v |
      | os-v2 | os-v |
      | os-w1 | os-w |
      | os-w2 | os-w |
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_activity  | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions | 0      | 2      | 1      | 0      |
      | 1       | directus_users     | 1      | 0      | 0      | 0      |
      | 1       | test_nws_card      | 6      | 1      | 0      | 0      |
      | 1       | test_nws_deck      | 2      | 1      | 0      | 0      |
      | 2       | directus_activity  | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions | 0      | 2      | 1      | 0      |
      | 2       | directus_users     | 1      | 0      | 0      | 0      |
      | 2       | test_nws_card      | 6      | 1      | 0      | 0      |
      | 2       | test_nws_deck      | 2      | 1      | 0      | 0      |

  Scenario: a many-to-many create of twenty parents runs the statements of two
    Given the rows of test_nws_tag:
      | id    |
      | ms-t1 |
      | ms-t2 |
    When these requests get these responses:
      | request                        | response  |
      | method: POST                   | code: 200 |+
      | path: /items/test_nws_post     |           |
      | payload:                       |           |
      |   - id: ms-a                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-a1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-a2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-b                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-b1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-b2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      | method: POST                   | code: 200 |+
      | path: /items/test_nws_post     |           |
      | payload:                       |           |
      |   - id: ms-c                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-c1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-c2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-d                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-d1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-d2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-e                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-e1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-e2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-f                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-f1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-f2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-g                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-g1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-g2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-h                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-h1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-h2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-i                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-i1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-i2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-j                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-j1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-j2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-k                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-k1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-k2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-l                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-l1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-l2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-m                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-m1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-m2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-n                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-n1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-n2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-o                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-o1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-o2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-p                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-p1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-p2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-q                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-q1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-q2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-r                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-r1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-r2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-s                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-s1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-s2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-u                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-u1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-u2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-v                   |           |
      |     owner: u1                  |           |
      |     tags:                      |           |
      |       - id: ms-v1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-v2              |           |
      |         test_nws_tag_id: ms-t2 |           |
      |   - id: ms-w                   |           |
      |     owner: u2                  |           |
      |     tags:                      |           |
      |       - id: ms-w1              |           |
      |         test_nws_tag_id: ms-t1 |           |
      |       - id: ms-w2              |           |
      |         test_nws_tag_id: ms-t2 |           |
    Then the rows of test_nws_post_tag whose key starts with "ms-" are:
      | id    | test_nws_post_id | test_nws_tag_id |
      | ms-a1 | ms-a             | ms-t1           |
      | ms-a2 | ms-a             | ms-t2           |
      | ms-b1 | ms-b             | ms-t1           |
      | ms-b2 | ms-b             | ms-t2           |
      | ms-c1 | ms-c             | ms-t1           |
      | ms-c2 | ms-c             | ms-t2           |
      | ms-d1 | ms-d             | ms-t1           |
      | ms-d2 | ms-d             | ms-t2           |
      | ms-e1 | ms-e             | ms-t1           |
      | ms-e2 | ms-e             | ms-t2           |
      | ms-f1 | ms-f             | ms-t1           |
      | ms-f2 | ms-f             | ms-t2           |
      | ms-g1 | ms-g             | ms-t1           |
      | ms-g2 | ms-g             | ms-t2           |
      | ms-h1 | ms-h             | ms-t1           |
      | ms-h2 | ms-h             | ms-t2           |
      | ms-i1 | ms-i             | ms-t1           |
      | ms-i2 | ms-i             | ms-t2           |
      | ms-j1 | ms-j             | ms-t1           |
      | ms-j2 | ms-j             | ms-t2           |
      | ms-k1 | ms-k             | ms-t1           |
      | ms-k2 | ms-k             | ms-t2           |
      | ms-l1 | ms-l             | ms-t1           |
      | ms-l2 | ms-l             | ms-t2           |
      | ms-m1 | ms-m             | ms-t1           |
      | ms-m2 | ms-m             | ms-t2           |
      | ms-n1 | ms-n             | ms-t1           |
      | ms-n2 | ms-n             | ms-t2           |
      | ms-o1 | ms-o             | ms-t1           |
      | ms-o2 | ms-o             | ms-t2           |
      | ms-p1 | ms-p             | ms-t1           |
      | ms-p2 | ms-p             | ms-t2           |
      | ms-q1 | ms-q             | ms-t1           |
      | ms-q2 | ms-q             | ms-t2           |
      | ms-r1 | ms-r             | ms-t1           |
      | ms-r2 | ms-r             | ms-t2           |
      | ms-s1 | ms-s             | ms-t1           |
      | ms-s2 | ms-s             | ms-t2           |
      | ms-u1 | ms-u             | ms-t1           |
      | ms-u2 | ms-u             | ms-t2           |
      | ms-v1 | ms-v             | ms-t1           |
      | ms-v2 | ms-v             | ms-t2           |
      | ms-w1 | ms-w             | ms-t1           |
      | ms-w2 | ms-w             | ms-t2           |
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_activity  | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions | 0      | 2      | 1      | 0      |
      | 1       | directus_users     | 1      | 0      | 0      | 0      |
      | 1       | test_nws_post      | 2      | 1      | 0      | 0      |
      | 1       | test_nws_post_tag  | 6      | 1      | 0      | 0      |
      | 2       | directus_activity  | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions | 0      | 2      | 1      | 0      |
      | 2       | directus_users     | 1      | 0      | 0      | 0      |
      | 2       | test_nws_post      | 2      | 1      | 0      | 0      |
      | 2       | test_nws_post_tag  | 6      | 1      | 0      | 0      |

  Scenario: twenty parents whose children nest new labels run the statements of two
    When these requests get these responses:
      | request                     | response  |
      | method: POST                | code: 200 |+
      | path: /items/test_nws_shelf |           |
      | payload:                    |           |
      |   - id: nr-a                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-a1           |           |
      |         label:              |           |
      |           name: nr-a1       |           |
      |       - id: nr-a2           |           |
      |         label:              |           |
      |           name: nr-a2       |           |
      |   - id: nr-b                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-b1           |           |
      |         label:              |           |
      |           name: nr-b1       |           |
      |       - id: nr-b2           |           |
      |         label:              |           |
      |           name: nr-b2       |           |
      | method: POST                | code: 200 |+
      | path: /items/test_nws_shelf |           |
      | payload:                    |           |
      |   - id: nr-c                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-c1           |           |
      |         label:              |           |
      |           name: nr-c1       |           |
      |       - id: nr-c2           |           |
      |         label:              |           |
      |           name: nr-c2       |           |
      |   - id: nr-d                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-d1           |           |
      |         label:              |           |
      |           name: nr-d1       |           |
      |       - id: nr-d2           |           |
      |         label:              |           |
      |           name: nr-d2       |           |
      |   - id: nr-e                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-e1           |           |
      |         label:              |           |
      |           name: nr-e1       |           |
      |       - id: nr-e2           |           |
      |         label:              |           |
      |           name: nr-e2       |           |
      |   - id: nr-f                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-f1           |           |
      |         label:              |           |
      |           name: nr-f1       |           |
      |       - id: nr-f2           |           |
      |         label:              |           |
      |           name: nr-f2       |           |
      |   - id: nr-g                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-g1           |           |
      |         label:              |           |
      |           name: nr-g1       |           |
      |       - id: nr-g2           |           |
      |         label:              |           |
      |           name: nr-g2       |           |
      |   - id: nr-h                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-h1           |           |
      |         label:              |           |
      |           name: nr-h1       |           |
      |       - id: nr-h2           |           |
      |         label:              |           |
      |           name: nr-h2       |           |
      |   - id: nr-i                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-i1           |           |
      |         label:              |           |
      |           name: nr-i1       |           |
      |       - id: nr-i2           |           |
      |         label:              |           |
      |           name: nr-i2       |           |
      |   - id: nr-j                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-j1           |           |
      |         label:              |           |
      |           name: nr-j1       |           |
      |       - id: nr-j2           |           |
      |         label:              |           |
      |           name: nr-j2       |           |
      |   - id: nr-k                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-k1           |           |
      |         label:              |           |
      |           name: nr-k1       |           |
      |       - id: nr-k2           |           |
      |         label:              |           |
      |           name: nr-k2       |           |
      |   - id: nr-l                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-l1           |           |
      |         label:              |           |
      |           name: nr-l1       |           |
      |       - id: nr-l2           |           |
      |         label:              |           |
      |           name: nr-l2       |           |
      |   - id: nr-m                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-m1           |           |
      |         label:              |           |
      |           name: nr-m1       |           |
      |       - id: nr-m2           |           |
      |         label:              |           |
      |           name: nr-m2       |           |
      |   - id: nr-n                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-n1           |           |
      |         label:              |           |
      |           name: nr-n1       |           |
      |       - id: nr-n2           |           |
      |         label:              |           |
      |           name: nr-n2       |           |
      |   - id: nr-o                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-o1           |           |
      |         label:              |           |
      |           name: nr-o1       |           |
      |       - id: nr-o2           |           |
      |         label:              |           |
      |           name: nr-o2       |           |
      |   - id: nr-p                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-p1           |           |
      |         label:              |           |
      |           name: nr-p1       |           |
      |       - id: nr-p2           |           |
      |         label:              |           |
      |           name: nr-p2       |           |
      |   - id: nr-q                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-q1           |           |
      |         label:              |           |
      |           name: nr-q1       |           |
      |       - id: nr-q2           |           |
      |         label:              |           |
      |           name: nr-q2       |           |
      |   - id: nr-r                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-r1           |           |
      |         label:              |           |
      |           name: nr-r1       |           |
      |       - id: nr-r2           |           |
      |         label:              |           |
      |           name: nr-r2       |           |
      |   - id: nr-s                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-s1           |           |
      |         label:              |           |
      |           name: nr-s1       |           |
      |       - id: nr-s2           |           |
      |         label:              |           |
      |           name: nr-s2       |           |
      |   - id: nr-u                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-u1           |           |
      |         label:              |           |
      |           name: nr-u1       |           |
      |       - id: nr-u2           |           |
      |         label:              |           |
      |           name: nr-u2       |           |
      |   - id: nr-v                |           |
      |     owner: u2               |           |
      |     books:                  |           |
      |       - id: nr-v1           |           |
      |         label:              |           |
      |           name: nr-v1       |           |
      |       - id: nr-v2           |           |
      |         label:              |           |
      |           name: nr-v2       |           |
      |   - id: nr-w                |           |
      |     owner: u1               |           |
      |     books:                  |           |
      |       - id: nr-w1           |           |
      |         label:              |           |
      |           name: nr-w1       |           |
      |       - id: nr-w2           |           |
      |         label:              |           |
      |           name: nr-w2       |           |
    Then the rows of test_nws_book whose key starts with "nr-" are:
      | id    | shelf |
      | nr-a1 | nr-a  |
      | nr-a2 | nr-a  |
      | nr-b1 | nr-b  |
      | nr-b2 | nr-b  |
      | nr-c1 | nr-c  |
      | nr-c2 | nr-c  |
      | nr-d1 | nr-d  |
      | nr-d2 | nr-d  |
      | nr-e1 | nr-e  |
      | nr-e2 | nr-e  |
      | nr-f1 | nr-f  |
      | nr-f2 | nr-f  |
      | nr-g1 | nr-g  |
      | nr-g2 | nr-g  |
      | nr-h1 | nr-h  |
      | nr-h2 | nr-h  |
      | nr-i1 | nr-i  |
      | nr-i2 | nr-i  |
      | nr-j1 | nr-j  |
      | nr-j2 | nr-j  |
      | nr-k1 | nr-k  |
      | nr-k2 | nr-k  |
      | nr-l1 | nr-l  |
      | nr-l2 | nr-l  |
      | nr-m1 | nr-m  |
      | nr-m2 | nr-m  |
      | nr-n1 | nr-n  |
      | nr-n2 | nr-n  |
      | nr-o1 | nr-o  |
      | nr-o2 | nr-o  |
      | nr-p1 | nr-p  |
      | nr-p2 | nr-p  |
      | nr-q1 | nr-q  |
      | nr-q2 | nr-q  |
      | nr-r1 | nr-r  |
      | nr-r2 | nr-r  |
      | nr-s1 | nr-s  |
      | nr-s2 | nr-s  |
      | nr-u1 | nr-u  |
      | nr-u2 | nr-u  |
      | nr-v1 | nr-v  |
      | nr-v2 | nr-v  |
      | nr-w1 | nr-w  |
      | nr-w2 | nr-w  |
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_activity  | 0      | 3      | 0      | 0      |
      | 1       | directus_revisions | 0      | 3      | 1      | 0      |
      | 1       | directus_users     | 1      | 0      | 0      | 0      |
      | 1       | test_nws_book      | 6      | 1      | 0      | 0      |
      | 1       | test_nws_label     | 0      | 1      | 0      | 0      |
      | 1       | test_nws_shelf     | 2      | 1      | 0      | 0      |
      | 2       | directus_activity  | 0      | 3      | 0      | 0      |
      | 2       | directus_revisions | 0      | 3      | 1      | 0      |
      | 2       | directus_users     | 1      | 0      | 0      | 0      |
      | 2       | test_nws_book      | 6      | 1      | 0      | 0      |
      | 2       | test_nws_label     | 0      | 1      | 0      | 0      |
      | 2       | test_nws_shelf     | 2      | 1      | 0      | 0      |
