Feature: A version is renamed only onto a key its item holds no version under

  - `test_write_renamed` is versioned, its `title` a string.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for the key a `remember: name` row
    stored. A response cell states the keys it checks.

  Scenario: a version renamed onto the key of another version is refused
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /items/test_write_renamed  |           |
      | payload:                         |           |
      |   title: renamed-<run>           |           |
      | remember: document               |           |
      | method: POST                     | code: 200 |+
      | path: /versions                  |           |
      | payload:                         |           |
      |   key: draft                     |           |
      |   collection: test_write_renamed |           |
      |   item: '<document>'             |           |
      | method: POST                     | code: 200 |+
      | path: /versions                  |           |
      | payload:                         |           |
      |   key: review                    |           |
      |   collection: test_write_renamed |           |
      |   item: '<document>'             |           |
      | remember: review-version         |           |
    Then these requests get these responses:
      | request                           | response                      |
      | method: PATCH                     | code: 422                     |+
      | path: /versions/<review-version>  | body:                         |
      | payload:                          |   errors:                     |
      |   key: draft                      |     - message: >-             |
      |                                   |         Can't process         |
      |                                   |         content. Version      |
      |                                   |         "draft" already       |
      |                                   |         exists for item       |
      |                                   |         "<document>" in       |
      |                                   |         collection            |
      |                                   |         "test_write_renamed". |
      | method: GET                       | code: 200                     |+
      | path: /versions                   | body:                         |
      | query:                            |   data:                       |
      |   fields: key                     |     - key: draft              |
      |   sort: key                       |     - key: review             |
      |   filter[collection][_eq]: >-     |                               |
      |     test_write_renamed            |                               |
      |   filter[item][_eq]: '<document>' |                               |
