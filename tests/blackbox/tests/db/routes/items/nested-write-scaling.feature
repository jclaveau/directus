Feature: A nested write runs the statements of two parents for six, but one

  - The planner creates a batch of parents together with their children; #414
    batched those nested writes so their statements no longer grow with the
    batch. Each scenario sends the same nested create twice, first with two
    parents, then with six, and holds both requests to the same counts.
  - Every child collection is scoped through its parent (`scoped_cache_fields`
    on a relational path), as the planner's are, so the purge's scope reads
    are counted too. Activity and revisions are kept, as in the planner.
  - Every key is a string the scenario chooses, all of one scenario's keys
    sharing a prefix of its own.
  - A Given creates its table's rows in one request. A request authenticates
    as the admin. A response cell states the keys it checks.
  - A Then reads back every row whose key starts with the prefix, sorted by
    key, with the table's columns; a row the table leaves out does not exist.
  - Every request goes to an instance of the feature's own, sharing the
    database, with the scoped cache on, that reports the statements each
    request ran (`QUERY_AUDIT_HEADER`). The last step counts a request's
    statements per table and kind, on postgres alone.
  - One count still grows with the parents: each created parent with nested
    children links its children's revisions in an update of its own on
    `directus_revisions`, 2 for two parents and 6 for six (#414).

  Scenario: a one-to-many create of six parents runs the statements of two, but one
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
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_activity  | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions | 0      | 2      | 2      | 0      |
      | 1       | directus_users     | 1      | 0      | 0      | 0      |
      | 1       | test_nws_card      | 6      | 1      | 0      | 0      |
      | 1       | test_nws_deck      | 2      | 1      | 0      | 0      |
      | 2       | directus_activity  | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions | 0      | 2      | 6      | 0      |
      | 2       | directus_users     | 1      | 0      | 0      | 0      |
      | 2       | test_nws_card      | 6      | 1      | 0      | 0      |
      | 2       | test_nws_deck      | 2      | 1      | 0      | 0      |

  Scenario: a many-to-many create of six parents runs the statements of two, but one
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
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_activity  | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions | 0      | 2      | 2      | 0      |
      | 1       | directus_users     | 1      | 0      | 0      | 0      |
      | 1       | test_nws_post      | 2      | 1      | 0      | 0      |
      | 1       | test_nws_post_tag  | 6      | 1      | 0      | 0      |
      | 2       | directus_activity  | 0      | 2      | 0      | 0      |
      | 2       | directus_revisions | 0      | 2      | 6      | 0      |
      | 2       | directus_users     | 1      | 0      | 0      | 0      |
      | 2       | test_nws_post      | 2      | 1      | 0      | 0      |
      | 2       | test_nws_post_tag  | 6      | 1      | 0      | 0      |
