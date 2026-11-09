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
    scenario's tags.
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
