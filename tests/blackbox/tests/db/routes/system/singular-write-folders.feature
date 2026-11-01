Feature: Folders are written one at a time or in batches

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response cell
    states the keys it checks.

  Scenario: a folder is created, renamed one by one and in batches, deleted
    Given these requests are sent:
      | request              | response  |
      | method: POST         | code: 200 |+
      | path: /folders       |           |
      | payload:             |           |
      |   id: <parent>       |           |
      |   name: parent-<run> |           |
    Then these requests get these responses:
      | request                     | response                |
      | method: POST                | code: 200               |+
      | path: /folders              | body:                   |
      | query:                      |   data:                 |
      |   fields: id,name           |     id: <folder>        |
      | payload:                    |     name: created-<run> |
      |   id: <folder>              |                         |
      |   name: created-<run>       |                         |
      | method: PATCH               | code: 200               |+
      | path: /folders/<folder>     | body:                   |
      | query:                      |   data:                 |
      |   fields: name              |     name: one-<run>     |
      | payload:                    |                         |
      |   name: one-<run>           |                         |
      | method: PATCH               | code: 200               |+
      | path: /folders              | body:                   |
      | query:                      |   data:                 |
      |   fields: name              |     - name: batch-<run> |
      | payload:                    |                         |
      |   - id: <folder>            |                         |
      |     name: batch-<run>       |                         |
      | method: PATCH               | code: 200               |+
      | path: /folders              | body:                   |
      | query:                      |   data:                 |
      |   fields: name,parent       |     - name: batch-<run> |
      | payload:                    |       parent: <parent>  |
      |   query:                    |                         |
      |     filter:                 |                         |
      |       name:                 |                         |
      |         _eq: batch-<run>    |                         |
      |   data:                     |                         |
      |     parent: <parent>        |                         |
      | method: DELETE              | code: 204               |+
      | path: /folders/<folder>     |                         |
      | method: GET                 | code: 200               |+
      | path: /folders              | body:                   |
      | query:                      |   data: []              |
      |   fields: id                |                         |
      |   filter[id][_eq]: <folder> |                         |
