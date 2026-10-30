Feature: Dashboards and their panels are written one at a time or in batches

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response cell
    states the keys it checks.

  Scenario: a dashboard is created, renamed one by one and in batches, deleted
    Then these requests get these responses:
      | request                    | response                  |
      | method: POST               | code: 200                 |+
      | path: /dashboards          | body:                     |
      | query:                     |   data:                   |
      |   fields: id,name          |     id: <board>           |
      | payload:                   |     name: created-<run>   |
      |   id: <board>              |                           |
      |   name: created-<run>      |                           |
      | method: PATCH              | code: 200                 |+
      | path: /dashboards/<board>  | body:                     |
      | query:                     |   data:                   |
      |   fields: name             |     name: one-<run>       |
      | payload:                   |                           |
      |   name: one-<run>          |                           |
      | method: PATCH              | code: 200                 |+
      | path: /dashboards          | body:                     |
      | query:                     |   data:                   |
      |   fields: name             |     - name: batch-<run>   |
      | payload:                   |                           |
      |   - id: <board>            |                           |
      |     name: batch-<run>      |                           |
      | method: PATCH              | code: 200                 |+
      | path: /dashboards          | body:                     |
      | query:                     |   data:                   |
      |   fields: name,note        |     - name: batch-<run>   |
      | payload:                   |       note: queried-<run> |
      |   query:                   |                           |
      |     filter:                |                           |
      |       name:                |                           |
      |         _eq: batch-<run>   |                           |
      |   data:                    |                           |
      |     note: queried-<run>    |                           |
      | method: DELETE             | code: 204                 |+
      | path: /dashboards/<board>  |                           |
      | method: GET                | code: 200                 |+
      | path: /dashboards          | body:                     |
      | query:                     |   data: []                |
      |   fields: id               |                           |
      |   filter[id][_eq]: <board> |                           |

  Scenario: a panel is created, moved one by one and in batches, deleted
    Given these requests are sent:
      | request              | response  |
      | method: POST         | code: 200 |+
      | path: /dashboards    |           |
      | payload:             |           |
      |   id: <board>        |           |
      |   name: panels-<run> |           |
    Then these requests get these responses:
      | request                           | response                |
      | method: POST                      | code: 200               |+
      | path: /panels                     | body:                   |
      | query:                            |   data:                 |
      |   fields: id,dashboard,name       |     id: <panel>         |
      | payload:                          |     dashboard: <board>  |
      |   id: <panel>                     |     name: created-<run> |
      |   dashboard: <board>              |                         |
      |   name: created-<run>             |                         |
      |   type: label                     |                         |
      |   position_x: 1                   |                         |
      |   position_y: 1                   |                         |
      |   width: 4                        |                         |
      |   height: 4                       |                         |
      | method: PATCH                     | code: 200               |+
      | path: /panels/<panel>             | body:                   |
      | query:                            |   data:                 |
      |   fields: position_x              |     position_x: 2       |
      | payload:                          |                         |
      |   position_x: 2                   |                         |
      | method: PATCH                     | code: 200               |+
      | path: /panels                     | body:                   |
      | query:                            |   data:                 |
      |   fields: position_x              |     - position_x: 3     |
      | payload:                          |                         |
      |   - id: <panel>                   |                         |
      |     position_x: 3                 |                         |
      | method: PATCH                     | code: 200               |+
      | path: /panels                     | body:                   |
      | query:                            |   data:                 |
      |   fields: position_x,position_y   |     - position_x: 3     |
      | payload:                          |       position_y: 5     |
      |   query:                          |                         |
      |     filter:                       |                         |
      |       dashboard:                  |                         |
      |         _eq: <board>              |                         |
      |   data:                           |                         |
      |     position_y: 5                 |                         |
      | method: DELETE                    | code: 204               |+
      | path: /panels/<panel>             |                         |
      | method: GET                       | code: 200               |+
      | path: /panels                     | body:                   |
      | query:                            |   data: []              |
      |   fields: id                      |                         |
      |   filter[dashboard][_eq]: <board> |                         |
