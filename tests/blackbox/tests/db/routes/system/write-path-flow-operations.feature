Feature: Flow item operations write through the service call their options pick

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response cell
    states the keys it checks.
  - Flows load in the background, so a request marked `eventually` is sent
    again until its response matches, for up to ten seconds.
  - Cards live in `test_wp_flow_cards`, keyed by a string `id`.
  - The flow's operations are created last to first, each resolving to the
    one after it; activating the flow on the first loads the whole chain.

  Scenario: a chain of item operations updates and deletes the cards its options name
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /items/test_wp_flow_cards    |           |
      | payload:                           |           |
      |   - id: alpha-<run>                |           |
      |     title: before                  |           |
      |   - id: beta-<run>                 |           |
      |     title: before                  |           |
      |   - id: gamma-<run>                |           |
      |     title: before                  |           |
      |   - id: delta-<run>                |           |
      |     title: before                  |           |
      |   - id: removed-<run>              |           |
      |     title: before                  |           |
      | method: POST                       | code: 200 |+
      | path: /flows                       |           |
      | payload:                           |           |
      |   id: <flow>                       |           |
      |   name: item-operations-<run>      |           |
      |   trigger: webhook                 |           |
      |   status: inactive                 |           |
      |   accountability: null             |           |
      |   options:                         |           |
      |     method: POST                   |           |
      | method: POST                       | code: 200 |+
      | path: /operations                  |           |
      | payload:                           |           |
      |   id: <deleting>                   |           |
      |   flow: <flow>                     |           |
      |   key: deleting                    |           |
      |   type: item-delete                |           |
      |   position_x: 80                   |           |
      |   position_y: 1                    |           |
      |   options:                         |           |
      |     collection: test_wp_flow_cards |           |
      |     key: removed-<run>             |           |
      |     permissions: $full             |           |
      | method: POST                       | code: 200 |+
      | path: /operations                  |           |
      | payload:                           |           |
      |   id: <keyed>                      |           |
      |   flow: <flow>                     |           |
      |   key: keyed                       |           |
      |   type: item-update                |           |
      |   position_x: 60                   |           |
      |   position_y: 1                    |           |
      |   resolve: <deleting>              |           |
      |   options:                         |           |
      |     collection: test_wp_flow_cards |           |
      |     key: delta-<run>               |           |
      |     payload:                       |           |
      |       title: keyed                 |           |
      |     permissions: $full             |           |
      | method: POST                       | code: 200 |+
      | path: /operations                  |           |
      | payload:                           |           |
      |   id: <queried>                    |           |
      |   flow: <flow>                     |           |
      |   key: queried                     |           |
      |   type: item-update                |           |
      |   position_x: 40                   |           |
      |   position_y: 1                    |           |
      |   resolve: <keyed>                 |           |
      |   options:                         |           |
      |     collection: test_wp_flow_cards |           |
      |     query:                         |           |
      |       filter:                      |           |
      |         id:                        |           |
      |           _eq: gamma-<run>         |           |
      |     payload:                       |           |
      |       title: queried               |           |
      |     permissions: $full             |           |
      | method: POST                       | code: 200 |+
      | path: /operations                  |           |
      | payload:                           |           |
      |   id: <batched>                    |           |
      |   flow: <flow>                     |           |
      |   key: batched                     |           |
      |   type: item-update                |           |
      |   position_x: 20                   |           |
      |   position_y: 1                    |           |
      |   resolve: <queried>               |           |
      |   options:                         |           |
      |     collection: test_wp_flow_cards |           |
      |     payload:                       |           |
      |       - id: alpha-<run>            |           |
      |         title: batched             |           |
      |       - id: beta-<run>             |           |
      |         title: batched             |           |
      |     permissions: $full             |           |
      | method: PATCH                      | code: 200 |+
      | path: /flows/<flow>                |           |
      | payload:                           |           |
      |   status: active                   |           |
      |   operation: <batched>             |           |
    Then these requests get these responses:
      | request                         | response              |
      | method: POST                    | code: 200             |+
      | path: /flows/trigger/<flow>     | body: removed-<run>   |
      | eventually: true                |                       |
      | method: GET                     | code: 200             |+
      | path: /items/test_wp_flow_cards | body:                 |
      | query:                          |   data:               |
      |   filter[id][_contains]: <run>  |     - id: alpha-<run> |
      |   sort: id                      |       title: batched  |
      |                                 |     - id: beta-<run>  |
      |                                 |       title: batched  |
      |                                 |     - id: delta-<run> |
      |                                 |       title: keyed    |
      |                                 |     - id: gamma-<run> |
      |                                 |       title: queried  |
      | method: DELETE                  | code: 204             |+
      | path: /flows/<flow>             |                       |
