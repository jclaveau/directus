Feature: A single flow is loaded as it is created and unloaded as it is deleted

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response cell
    states the keys it checks.
  - Flows load in the background, so a request marked `eventually` is sent
    again until its response matches, for up to ten seconds.

  Scenario: a webhook flow answers its trigger until it is deleted
    Then these requests get these responses:
      | request                     | response                             |
      | method: POST                | code: 200                            |+
      | path: /flows                | body:                                |
      | payload:                    |   data:                              |
      |   id: <flow>                |     id: <flow>                       |
      |   name: webhook-<run>       |     trigger: webhook                 |
      |   trigger: webhook          |                                      |
      |   status: active            |                                      |
      |   accountability: null      |                                      |
      |   options:                  |                                      |
      |     method: POST            |                                      |
      | method: POST                | code: 200                            |+
      | path: /flows/trigger/<flow> | body:                                |
      | payload:                    |   method: POST                       |
      |   probe: <run>              |   body:                              |
      | eventually: true            |     probe: <run>                     |
      | method: DELETE              | code: 204                            |+
      | path: /flows/<flow>         |                                      |
      | method: POST                | code: 403                            |+
      | path: /flows/trigger/<flow> | body:                                |
      | payload:                    |   errors:                            |
      |   probe: <run>              |     - message: >-                    |
      | eventually: true            |         You don't have permission to |
      |                             |         access this.                 |

  Scenario: a flow deleted with its chained operations takes them along
    Given these requests are sent:
      | request                | response  |
      | method: POST           | code: 200 |+
      | path: /flows           |           |
      | payload:               |           |
      |   id: <flow>           |           |
      |   name: chain-<run>    |           |
      |   trigger: webhook     |           |
      |   status: inactive     |           |
      |   accountability: null |           |
      | method: POST           | code: 200 |+
      | path: /operations      |           |
      | payload:               |           |
      |   id: <second>         |           |
      |   flow: <flow>         |           |
      |   key: second          |           |
      |   type: log            |           |
      |   position_x: 20       |           |
      |   position_y: 1        |           |
      |   options:             |           |
      |     message: second    |           |
      | method: POST           | code: 200 |+
      | path: /operations      |           |
      | payload:               |           |
      |   id: <first>          |           |
      |   flow: <flow>         |           |
      |   key: first           |           |
      |   type: log            |           |
      |   position_x: 1        |           |
      |   position_y: 1        |           |
      |   resolve: <second>    |           |
      |   options:             |           |
      |     message: first     |           |
    Then these requests get these responses:
      | request                     | response   |
      | method: DELETE              | code: 204  |+
      | path: /flows/<flow>         |            |
      | method: GET                 | code: 200  |+
      | path: /operations           | body:      |
      | query:                      |   data: [] |
      |   fields: id                |            |
      |   filter[flow][_eq]: <flow> |            |
      | method: GET                 | code: 200  |+
      | path: /flows                | body:      |
      | query:                      |   data: [] |
      |   fields: id                |            |
      |   filter[id][_eq]: <flow>   |            |
