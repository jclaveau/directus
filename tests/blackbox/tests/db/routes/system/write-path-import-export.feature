Feature: Imports write each row, exports notify whoever asked

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.
  - Crates live in `test_wp_porter_crates`, keyed by a string `id`;
    `test_wp_porter_broken` is shaped the same and only ever exported badly.
  - An export answers before it runs, so a request marked `eventually` is
    sent again until its response matches, for up to ten seconds.

  Scenario: a JSON import writes each row it holds
    Then these requests get these responses:
      | request                                       | response             |
      | method: POST                                  | code: 200            |+
      | path: /utils/import/test_wp_porter_crates     |                      |
      | file:                                         |                      |
      |   name: crates.json                           |                      |
      |   content: >-                                 |                      |
      |     [{ "id": "json-<run>",                    |                      |
      |     "title": "from json" }]                   |                      |
      | method: GET                                   | code: 200            |+
      | path: /items/test_wp_porter_crates/json-<run> | body:                |
      |                                               |   data:              |
      |                                               |     title: from json |

  Scenario: a CSV import writes each row it holds
    Then these requests get these responses:
      | request                                       | response            |
      | method: POST                                  | code: 200           |+
      | path: /utils/import/test_wp_porter_crates     |                     |
      | file:                                         |                     |
      |   name: crates.csv                            |                     |
      |   content: "id,title\\ncsv-<run>,from csv\\n" |                     |
      | method: GET                                   | code: 200           |+
      | path: /items/test_wp_porter_crates/csv-<run>  | body:               |
      |                                               |   data:             |
      |                                               |     title: from csv |

  Scenario: a finished export leaves a file and a notification pointing at it
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /items/test_wp_porter_crates |           |
      | payload:                           |           |
      |   id: exported-<run>               |           |
      |   title: exported                  |           |
    Then these requests get these responses:
      | request                                   | response                         |
      | method: POST                              | code: 204                        |+
      | path: /utils/export/test_wp_porter_crates |                                  |
      | payload:                                  |                                  |
      |   query:                                  |                                  |
      |     filter:                               |                                  |
      |       id:                                 |                                  |
      |         _eq: exported-<run>               |                                  |
      |   format: json                            |                                  |
      |   file:                                   |                                  |
      |     title: export-<run>                   |                                  |
      | method: GET                               | code: 200                        |+
      | path: /files                              | body:                            |
      | query:                                    |   data:                          |
      |   filter[title][_eq]: export-<run>        |     - title: export-<run>        |
      | eventually: true                          |                                  |
      | remember:                                 |                                  |
      |   export_file: body.data.0.id             |                                  |
      | method: GET                               | code: 200                        |+
      | path: /notifications                      | body:                            |
      | query:                                    |   data:                          |
      |   filter[item][_eq]: <export_file>        |     - subject: >-                |
      | eventually: true                          |         Your export of           |
      |                                           |         test_wp_porter_crates    |
      |                                           |         is ready                 |
      |                                           |       collection: directus_files |

  Scenario: an export in a format no exporter knows is refused before it runs
    Then these requests get these responses:
      | request                                   | response                         |
      | method: POST                              | code: 400                        |+
      | path: /utils/export/test_wp_porter_broken | body:                            |
      | payload:                                  |   errors:                        |
      |   query: {}                               |     - message: >-                |
      |   format: pdf                             |         Invalid payload. Invalid |
      |   file: {}                                |         format "pdf". Allowed:   |
      |                                           |         csv, json, xml, yaml.    |

  Scenario: an export whose query fails as it runs notifies its failure
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /items/test_wp_porter_broken |           |
      | payload:                           |           |
      |   id: broken-<run>                 |           |
      |   title: broken                    |           |
    Then these requests get these responses:
      | request                                   | response                           |
      | method: POST                              | code: 204                          |+
      | path: /utils/export/test_wp_porter_broken |                                    |
      | payload:                                  |                                    |
      |   query:                                  |                                    |
      |     filter:                               |                                    |
      |       no_such_field:                      |                                    |
      |         _eq: broken-<run>                 |                                    |
      |   format: json                            |                                    |
      | method: GET                               | code: 200                          |+
      | path: /notifications                      | body:                              |
      | query:                                    |   data:                            |
      |   filter[subject][_eq]: >-                |     - message: >-                  |
      |     Your export of                        |         Please contact your system |
      |     test_wp_porter_broken failed          |         administrator for more     |
      | eventually: true                          |         information.               |
