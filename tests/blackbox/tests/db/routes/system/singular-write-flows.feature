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

  Scenario: webhook flows created in one batch answer their triggers
    Then these requests get these responses:
      | request                            | response                |
      | method: POST                       | code: 200               |+
      | path: /flows                       |                         |
      | payload:                           |                         |
      |   - id: <first-flow>               |                         |
      |     name: first-<run>              |                         |
      |     trigger: webhook               |                         |
      |     status: active                 |                         |
      |     accountability: null           |                         |
      |     options:                       |                         |
      |       method: POST                 |                         |
      |   - id: <second-flow>              |                         |
      |     name: second-<run>             |                         |
      |     trigger: webhook               |                         |
      |     status: active                 |                         |
      |     accountability: null           |                         |
      |     options:                       |                         |
      |       method: POST                 |                         |
      | method: POST                       | code: 200               |+
      | path: /flows/trigger/<first-flow>  | body:                   |
      | payload:                           |   method: POST          |
      |   probe: first-<run>               |   body:                 |
      | eventually: true                   |     probe: first-<run>  |
      | method: POST                       | code: 200               |+
      | path: /flows/trigger/<second-flow> | body:                   |
      | payload:                           |   method: POST          |
      |   probe: second-<run>              |   body:                 |
      | eventually: true                   |     probe: second-<run> |
      | method: DELETE                     | code: 204               |+
      | path: /flows                       |                         |
      | payload:                           |                         |
      |   - <first-flow>                   |                         |
      |   - <second-flow>                  |                         |

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

  Scenario: an inactive flow is renamed in batches and by a query
    Given these requests are sent:
      | request                | response  |
      | method: POST           | code: 200 |+
      | path: /flows           |           |
      | payload:               |           |
      |   id: <flow>           |           |
      |   name: created-<run>  |           |
      |   trigger: webhook     |           |
      |   status: inactive     |           |
      |   accountability: null |           |
    Then these requests get these responses:
      | request                        | response                         |
      | method: PATCH                  | code: 200                        |+
      | path: /flows                   | body:                            |
      | query:                         |   data:                          |
      |   fields: id,name              |     - id: <flow>                 |
      | payload:                       |       name: batch-<run>          |
      |   - id: <flow>                 |                                  |
      |     name: batch-<run>          |                                  |
      | method: PATCH                  | code: 200                        |+
      | path: /flows                   | body:                            |
      | query:                         |   data:                          |
      |   fields: id,description       |     - id: <flow>                 |
      | payload:                       |       description: queried-<run> |
      |   query:                       |                                  |
      |     filter:                    |                                  |
      |       name:                    |                                  |
      |         _eq: batch-<run>       |                                  |
      |   data:                        |                                  |
      |     description: queried-<run> |                                  |

  Scenario: an operation is moved one by one and in batches, then deleted
    Given these requests are sent:
      | request                  | response  |
      | method: POST             | code: 200 |+
      | path: /flows             |           |
      | payload:                 |           |
      |   id: <flow>             |           |
      |   name: operations-<run> |           |
      |   trigger: webhook       |           |
      |   status: inactive       |           |
      |   accountability: null   |           |
      | method: POST             | code: 200 |+
      | path: /operations        |           |
      | payload:                 |           |
      |   id: <step>             |           |
      |   flow: <flow>           |           |
      |   key: step              |           |
      |   type: log              |           |
      |   position_x: 1          |           |
      |   position_y: 1          |           |
      |   options:               |           |
      |     message: step        |           |
    Then these requests get these responses:
      | request                         | response            |
      | method: PATCH                   | code: 200           |+
      | path: /operations/<step>        | body:               |
      | query:                          |   data:             |
      |   fields: position_x            |     position_x: 2   |
      | payload:                        |                     |
      |   position_x: 2                 |                     |
      | method: PATCH                   | code: 200           |+
      | path: /operations               | body:               |
      | query:                          |   data:             |
      |   fields: position_x            |     - position_x: 3 |
      | payload:                        |                     |
      |   - id: <step>                  |                     |
      |     position_x: 3               |                     |
      | method: PATCH                   | code: 200           |+
      | path: /operations               | body:               |
      | query:                          |   data:             |
      |   fields: position_x,position_y |     - position_x: 3 |
      | payload:                        |       position_y: 5 |
      |   query:                        |                     |
      |     filter:                     |                     |
      |       flow:                     |                     |
      |         _eq: <flow>             |                     |
      |   data:                         |                     |
      |     position_y: 5               |                     |
      | method: DELETE                  | code: 204           |+
      | path: /operations/<step>        |                     |
      | method: GET                     | code: 200           |+
      | path: /operations               | body:               |
      | query:                          |   data: []          |
      |   fields: id                    |                     |
      |   filter[flow][_eq]: <flow>     |                     |
