Feature: Roles and policies are updated by a query

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response cell
    states the keys it checks.

  Scenario: a role matched by a query takes the update
    Given these requests are sent:
      | request               | response  |
      | method: POST          | code: 200 |+
      | path: /roles          |           |
      | payload:              |           |
      |   id: <role>          |           |
      |   name: queried-<run> |           |
    Then these requests get these responses:
      | request                        | response                         |
      | method: PATCH                  | code: 200                        |+
      | path: /roles                   | body:                            |
      | query:                         |   data:                          |
      |   fields: id,description       |     - id: <role>                 |
      | payload:                       |       description: queried-<run> |
      |   query:                       |                                  |
      |     filter:                    |                                  |
      |       name:                    |                                  |
      |         _eq: queried-<run>     |                                  |
      |   data:                        |                                  |
      |     description: queried-<run> |                                  |

  Scenario: a policy matched by a query takes the update
    Given these requests are sent:
      | request               | response  |
      | method: POST          | code: 200 |+
      | path: /policies       |           |
      | payload:              |           |
      |   id: <policy>        |           |
      |   name: queried-<run> |           |
      |   app_access: false   |           |
      |   admin_access: false |           |
    Then these requests get these responses:
      | request                        | response                         |
      | method: PATCH                  | code: 200                        |+
      | path: /policies                | body:                            |
      | query:                         |   data:                          |
      |   fields: id,description       |     - id: <policy>               |
      | payload:                       |       description: queried-<run> |
      |   query:                       |                                  |
      |     filter:                    |                                  |
      |       name:                    |                                  |
      |         _eq: queried-<run>     |                                  |
      |   data:                        |                                  |
      |     description: queried-<run> |                                  |
