Feature: An import writes the nested changes of every row it reads

  - A request cell is YAML: `method`, `path`, `query`, `payload`, `file`. A
    list under `query` is sent joined by commas. A `file` is uploaded as the
    JSON file of the rows an import reads. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - Every collection is keyed by strings the scenarios choose.
    `test_write_import_parent` reaches `test_write_import_page` through its
    any-to-one `target`, the collection named in `target_collection`. Its
    one-to-many `deleted` deletes the `test_write_import_deleted` rows it leaves
    out, its `nulled` nullifies the `test_write_import_nulled` rows it leaves
    out; both children hold their parent in `parent`.

  Scenario: an import updating a row given its children as lists writes them all
    When these requests get these responses:
      | request                                          | response              |
      | method: POST                                     | code: 200             |+
      | path: /items/test_write_import_page              |                       |
      | payload:                                         |                       |
      |   id: ip-page-kept                               |                       |
      |   title: before                                  |                       |
      | method: POST                                     | code: 200             |+
      | path: /items/test_write_import_parent            |                       |
      | payload:                                         |                       |
      |   id: ip-list                                    |                       |
      |   deleted:                                       |                       |
      |     - id: ip-list-d1                             |                       |
      |   nulled:                                        |                       |
      |     - id: ip-list-n1                             |                       |
      | method: POST                                     | code: 200             |+
      | path: /utils/import/test_write_import_parent     |                       |
      | file:                                            |                       |
      |   - id: ip-list                                  |                       |
      |     target_collection: test_write_import_page    |                       |
      |     target:                                      |                       |
      |       id: ip-page-kept                           |                       |
      |       title: after                               |                       |
      |     deleted:                                     |                       |
      |       - id: ip-list-d2                           |                       |
      |     nulled:                                      |                       |
      |       - id: ip-list-n2                           |                       |
      | method: GET                                      | code: 200             |+
      | path: /items/test_write_import_page/ip-page-kept | body:                 |
      |                                                  |   data:               |
      |                                                  |     title: after      |
      | method: GET                                      | code: 200             |+
      | path: /items/test_write_import_deleted           | body:                 |
      | query:                                           |   data:               |
      |   filter[id][_in]:                               |     - id: ip-list-d2  |
      |     - ip-list-d1                                 |       parent: ip-list |
      |     - ip-list-d2                                 |                       |
      |   fields:                                        |                       |
      |     - id                                         |                       |
      |     - parent                                     |                       |
      | method: GET                                      | code: 200             |+
      | path: /items/test_write_import_nulled            | body:                 |
      | query:                                           |   data:               |
      |   filter[id][_in]:                               |     - id: ip-list-n1  |
      |     - ip-list-n1                                 |       parent: null    |
      |     - ip-list-n2                                 |     - id: ip-list-n2  |
      |   fields:                                        |       parent: ip-list |
      |     - id                                         |                       |
      |     - parent                                     |                       |
      |   sort: id                                       |                       |
    And on postgres the requests ran these statements:
      | request | table                     | select | insert | update | delete |
      | 1       | directus_activity         | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions        | 0      | 1      | 0      | 0      |
      | 1       | directus_users            | 1      | 0      | 0      | 0      |
      | 1       | test_write_import_page    | 1      | 1      | 0      | 0      |
      | 2       | directus_activity         | 0      | 3      | 0      | 0      |
      | 2       | directus_revisions        | 0      | 3      | 1      | 0      |
      | 2       | directus_users            | 1      | 0      | 0      | 0      |
      | 2       | test_write_import_deleted | 4      | 1      | 0      | 0      |
      | 2       | test_write_import_nulled  | 4      | 1      | 0      | 0      |
      | 2       | test_write_import_parent  | 1      | 1      | 0      | 0      |
      | 3       | directus_activity         | 0      | 6      | 0      | 0      |
      | 3       | directus_revisions        | 0      | 5      | 1      | 0      |
      | 3       | directus_users            | 1      | 0      | 0      | 0      |
      | 3       | test_write_import_deleted | 4      | 1      | 0      | 1      |
      | 3       | test_write_import_nulled  | 5      | 1      | 1      | 0      |
      | 3       | test_write_import_page    | 2      | 0      | 1      | 0      |
      | 3       | test_write_import_parent  | 2      | 0      | 1      | 0      |

  Scenario: an import creating a row creates the page its any-to-one field holds
    When these requests get these responses:
      | request                                         | response                |
      | method: POST                                    | code: 200               |+
      | path: /utils/import/test_write_import_parent    |                         |
      | file:                                           |                         |
      |   - id: ip-new                                  |                         |
      |     target_collection: test_write_import_page   |                         |
      |     target:                                     |                         |
      |       id: ip-page-new                           |                         |
      |       title: created                            |                         |
      | method: GET                                     | code: 200               |+
      | path: /items/test_write_import_parent/ip-new    | body:                   |
      |                                                 |   data:                 |
      |                                                 |     target: ip-page-new |
      | method: GET                                     | code: 200               |+
      | path: /items/test_write_import_page/ip-page-new | body:                   |
      |                                                 |   data:                 |
      |                                                 |     title: created      |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_activity        | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions       | 0      | 2      | 1      | 0      |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_write_import_page   | 1      | 1      | 0      | 0      |
      | 1       | test_write_import_parent | 1      | 1      | 0      | 0      |

  Scenario: an import updating a row given changes to its children applies them
    When these requests get these responses:
      | request                                      | response                |
      | method: POST                                 | code: 200               |+
      | path: /items/test_write_import_parent        |                         |
      | payload:                                     |                         |
      |   id: ip-change                              |                         |
      |   deleted:                                   |                         |
      |     - id: ip-change-d1                       |                         |
      |   nulled:                                    |                         |
      |     - id: ip-change-n1                       |                         |
      |     - id: ip-change-n2                       |                         |
      | method: POST                                 | code: 200               |+
      | path: /utils/import/test_write_import_parent |                         |
      | file:                                        |                         |
      |   - id: ip-change                            |                         |
      |     deleted:                                 |                         |
      |       delete:                                |                         |
      |         - ip-change-d1                       |                         |
      |     nulled:                                  |                         |
      |       update:                                |                         |
      |         - id: ip-change-n1                   |                         |
      |           name: updated                      |                         |
      |       delete:                                |                         |
      |         - ip-change-n2                       |                         |
      | method: GET                                  | code: 200               |+
      | path: /items/test_write_import_deleted       | body:                   |
      | query:                                       |   data: []              |
      |   filter[id][_eq]: ip-change-d1              |                         |
      | method: GET                                  | code: 200               |+
      | path: /items/test_write_import_nulled        | body:                   |
      | query:                                       |   data:                 |
      |   filter[id][_in]:                           |     - id: ip-change-n1  |
      |     - ip-change-n1                           |       name: updated     |
      |     - ip-change-n2                           |       parent: ip-change |
      |   fields:                                    |     - id: ip-change-n2  |
      |     - id                                     |       name: null        |
      |     - name                                   |       parent: null      |
      |     - parent                                 |                         |
      |   sort: id                                   |                         |
    And on postgres the requests ran these statements:
      | request | table                     | select | insert | update | delete |
      | 1       | directus_activity         | 0      | 3      | 0      | 0      |
      | 1       | directus_revisions        | 0      | 3      | 1      | 0      |
      | 1       | directus_users            | 1      | 0      | 0      | 0      |
      | 1       | test_write_import_deleted | 4      | 1      | 0      | 0      |
      | 1       | test_write_import_nulled  | 4      | 1      | 0      | 0      |
      | 1       | test_write_import_parent  | 1      | 1      | 0      | 0      |
      | 2       | directus_activity         | 0      | 4      | 0      | 0      |
      | 2       | directus_revisions        | 0      | 2      | 0      | 0      |
      | 2       | directus_users            | 1      | 0      | 0      | 0      |
      | 2       | test_write_import_deleted | 2      | 0      | 0      | 1      |
      | 2       | test_write_import_nulled  | 5      | 0      | 2      | 0      |
      | 2       | test_write_import_parent  | 2      | 0      | 0      | 0      |
