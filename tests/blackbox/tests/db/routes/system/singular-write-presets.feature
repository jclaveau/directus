Feature: Presets are written one at a time or in batches

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own, or for the key
    a `remember: name` row stored. A response cell states the keys it checks.

  Scenario: a bookmark is renamed in batches, then deleted by its key
    Given these requests are sent:
      | request                      | response  |
      | method: POST                 | code: 200 |+
      | path: /presets               |           |
      | payload:                     |           |
      |   collection: directus_users |           |
      |   bookmark: created-<run>    |           |
      | remember: bookmark           |           |
    Then these requests get these responses:
      | request                              | response                    |
      | method: PATCH                        | code: 200                   |+
      | path: /presets                       | body:                       |
      | query:                               |   data:                     |
      |   fields: bookmark                   |     - bookmark: batch-<run> |
      | payload:                             |                             |
      |   - id: <bookmark>                   |                             |
      |     bookmark: batch-<run>            |                             |
      | method: PATCH                        | code: 200                   |+
      | path: /presets                       | body:                       |
      | query:                               |   data:                     |
      |   fields: bookmark,search            |     - bookmark: batch-<run> |
      | payload:                             |       search: queried-<run> |
      |   query:                             |                             |
      |     filter:                          |                             |
      |       bookmark:                      |                             |
      |         _eq: batch-<run>             |                             |
      |   data:                              |                             |
      |     search: queried-<run>            |                             |
      | method: DELETE                       | code: 204                   |+
      | path: /presets/<bookmark>            |                             |
      | method: GET                          | code: 200                   |+
      | path: /presets                       | body:                       |
      | query:                               |   data: []                  |
      |   fields: id                         |                             |
      |   filter[bookmark][_eq]: batch-<run> |                             |
