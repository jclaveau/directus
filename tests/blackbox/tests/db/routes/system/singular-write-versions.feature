Feature: A single version is checked and stamped with its item as it is created

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and `<name>` for the key a `remember: name` row stored. A
    response cell states the keys it checks.

  Scenario: a version holds its item's state until the item changes
    Given these requests are sent:
      | request                       | response  |
      | method: POST                  | code: 200 |+
      | path: /items/test_draft_items |           |
      | payload:                      |           |
      |   title: first-<run>          |           |
      | remember: document            |           |
    Then these requests get these responses:
      | request                                  | response               |
      | method: POST                             | code: 200              |+
      | path: /versions                          | body:                  |
      | payload:                                 |   data:                |
      |   key: draft                             |     key: draft         |
      |   name: draft                            |     item: '<document>' |
      |   collection: test_draft_items           |                        |
      |   item: '<document>'                     |                        |
      | remember: draft                          |                        |
      | method: GET                              | code: 200              |+
      | path: /versions/<draft>/compare          | body:                  |
      |                                          |   data:                |
      |                                          |     outdated: false    |
      | method: PATCH                            | code: 200              |+
      | path: /items/test_draft_items/<document> |                        |
      | payload:                                 |                        |
      |   title: second-<run>                    |                        |
      | method: GET                              | code: 200              |+
      | path: /versions/<draft>/compare          | body:                  |
      |                                          |   data:                |
      |                                          |     outdated: true     |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_activity    | 0      | 1      | 0      | 0      |
      | 1       | directus_collections | 1      | 0      | 0      | 0      |
      | 1       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 1       | directus_versions    | 2      | 1      | 0      | 0      |
      | 1       | pg_class             | 1      | 0      | 0      | 0      |
      | 1       | test_draft_items     | 1      | 0      | 0      | 0      |
      | 3       | directus_activity    | 0      | 1      | 0      | 0      |
      | 3       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |
      | 3       | test_draft_items     | 2      | 0      | 1      | 0      |

  Scenario: a batch of versions is checked and stamped like a single one
    Given these requests are sent:
      | request                       | response  |
      | method: POST                  | code: 200 |+
      | path: /items/test_draft_items |           |
      | payload:                      |           |
      |   title: batch-<run>          |           |
      | remember: document            |           |
    Then these requests get these responses:
      | request                           | response                        |
      | method: POST                      | code: 400                       |+
      | path: /versions                   | body:                           |
      | payload:                          |   errors:                       |
      |   - key: review                   |     - message: >-               |
      |     collection: test_draft_items  |         Invalid payload. "main" |
      |     item: '<document>'            |         is a reserved version   |
      |   - key: main                     |         key.                    |
      |     collection: test_draft_items  |                                 |
      |     item: '<document>'            |                                 |
      | method: POST                      | code: 200                       |+
      | path: /versions                   |                                 |
      | payload:                          |                                 |
      |   - key: draft                    |                                 |
      |     collection: test_draft_items  |                                 |
      |     item: '<document>'            |                                 |
      |   - key: review                   |                                 |
      |     collection: test_draft_items  |                                 |
      |     item: '<document>'            |                                 |
      | method: GET                       | code: 200                       |+
      | path: /versions                   | body:                           |
      | query:                            |   data:                         |
      |   fields: key                     |     - key: draft                |
      |   sort: key                       |     - key: review               |
      |   filter[item][_eq]: '<document>' |                                 |
      |   filter[hash][_nnull]: true      |                                 |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_collections | 1      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 1       | directus_versions    | 1      | 0      | 0      | 0      |
      | 1       | pg_class             | 1      | 0      | 0      | 0      |
      | 1       | test_draft_items     | 1      | 0      | 0      | 0      |
      | 2       | directus_activity    | 0      | 1      | 0      | 0      |
      | 2       | directus_collections | 2      | 0      | 0      | 0      |
      | 2       | directus_revisions   | 0      | 1      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | directus_versions    | 3      | 1      | 0      | 0      |
      | 2       | pg_class             | 2      | 0      | 0      | 0      |
      | 2       | test_draft_items     | 2      | 0      | 0      | 0      |

  Scenario: a second version of one key for one item is refused
    Given these requests are sent:
      | request                        | response  |
      | method: POST                   | code: 200 |+
      | path: /items/test_draft_items  |           |
      | payload:                       |           |
      |   title: twice-<run>           |           |
      | remember: document             |           |
      | method: POST                   | code: 200 |+
      | path: /versions                |           |
      | payload:                       |           |
      |   key: draft                   |           |
      |   collection: test_draft_items |           |
      |   item: '<document>'           |           |
    Then these requests get these responses:
      | request                                     | response                        |
      | method: POST                                | code: 422                       |+
      | path: /versions                             | body:                           |
      | payload:                                    |   errors:                       |
      |   key: draft                                |     - message: >-               |
      |   collection: test_draft_items              |         Can't process content.  |
      |   item: '<document>'                        |         Version "draft" already |
      |                                             |         exists for item         |
      |                                             |         "<document>" in         |
      |                                             |         collection              |
      |                                             |         "test_draft_items".     |
      | method: GET                                 | code: 200                       |+
      | path: /versions                             | body:                           |
      | query:                                      |   data:                         |
      |   fields: key                               |     - key: draft                |
      |   filter[collection][_eq]: test_draft_items |                                 |
      |   filter[item][_eq]: '<document>'           |                                 |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_collections | 1      | 0      | 0      | 0      |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 1       | directus_versions    | 1      | 0      | 0      | 0      |
      | 1       | pg_class             | 1      | 0      | 0      | 0      |

  Scenario: a version is refused before it is written
    Given these requests are sent:
      | request                       | response  |
      | method: POST                  | code: 200 |+
      | path: /items/test_draft_items |           |
      | payload:                      |           |
      |   title: refused-<run>        |           |
      | remember: document            |           |
      | method: POST                  | code: 200 |+
      | path: /items/test_plain_items |           |
      | payload:                      |           |
      |   title: refused-<run>        |           |
      | remember: unversioned         |           |
    Then these requests get these responses:
      | request                                     | response                          |
      | method: POST                                | code: 400                         |+
      | path: /versions                             | body:                             |
      | payload:                                    |   errors:                         |
      |   collection: test_draft_items              |     - message: >-                 |
      |   item: '<document>'                        |         Invalid payload. "key" is |
      |                                             |         required.                 |
      | method: POST                                | code: 400                         |+
      | path: /versions                             | body:                             |
      | payload:                                    |   errors:                         |
      |   key: main                                 |     - message: >-                 |
      |   collection: test_draft_items              |         Invalid payload. "main"   |
      |   item: '<document>'                        |         is a reserved version     |
      |                                             |         key.                      |
      | method: POST                                | code: 422                         |+
      | path: /versions                             | body:                             |
      | payload:                                    |   errors:                         |
      |   key: draft                                |     - message: >-                 |
      |   collection: test_plain_items              |         Can't process content.    |
      |   item: '<unversioned>'                     |         Content Versioning is not |
      |                                             |         enabled for collection    |
      |                                             |         "test_plain_items".       |
      | method: POST                                | code: 403                         |+
      | path: /versions                             | body:                             |
      | payload:                                    |   errors:                         |
      |   key: draft                                |     - message: >-                 |
      |   collection: test_singular_missing         |         You don't have permission |
      |   item: '<document>'                        |         to access this.           |
      | method: GET                                 | code: 200                         |+
      | path: /versions                             | body:                             |
      | query:                                      |   data: []                        |
      |   fields: key                               |                                   |
      |   filter[collection][_eq]: test_draft_items |                                   |
      |   filter[item][_eq]: '<document>'           |                                   |
    And on postgres the requests ran these statements:
      | request | table                | select | insert | update | delete |
      | 1       | directus_users       | 1      | 0      | 0      | 0      |
      | 2       | directus_users       | 1      | 0      | 0      | 0      |
      | 3       | directus_collections | 1      | 0      | 0      | 0      |
      | 3       | directus_users       | 1      | 0      | 0      | 0      |
      | 3       | pg_class             | 1      | 0      | 0      | 0      |
      | 4       | directus_users       | 1      | 0      | 0      | 0      |
