Feature: A flow run sees the role of the user who triggered it

  - Pins today's single-role contract (#746). A webhook flow hands its
    operations `$accountability`, whose `role` is the user's own role and
    `roles` its chain, parent first. Stored flow code reads them, such as the
    webhook flows migration 20240311A wrote.
  - The `exec` operation answers the two values; the flow returns the last
    operation's data as the response body.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a webhook flow run reads the user's role and its chain
    Given these requests are sent:
      | request                                   | response  |
      | method: POST                              | code: 200 |+
      | path: /roles                              |           |
      | payload:                                  |           |
      |   id: <parent-role>                       |           |
      |   name: parent-<run>                      |           |
      | method: POST                              | code: 200 |+
      | path: /roles                              |           |
      | payload:                                  |           |
      |   id: <child-role>                        |           |
      |   name: child-<run>                       |           |
      |   parent: <parent-role>                   |           |
      | method: POST                              | code: 200 |+
      | path: /users                              |           |
      | payload:                                  |           |
      |   email: trigger-<run>@example.com        |           |
      |   role: <child-role>                      |           |
      |   token: trigger-<run>                    |           |
      | method: POST                              | code: 200 |+
      | path: /flows                              |           |
      | payload:                                  |           |
      |   id: <flow>                              |           |
      |   name: accountability-<run>              |           |
      |   status: active                          |           |
      |   accountability: all                     |           |
      |   trigger: webhook                        |           |
      |   options:                                |           |
      |     method: GET                           |           |
      |     return: $last                         |           |
      | method: POST                              | code: 200 |+
      | path: /operations                         |           |
      | payload:                                  |           |
      |   id: <operation>                         |           |
      |   flow: <flow>                            |           |
      |   key: accountability_role                |           |
      |   type: exec                              |           |
      |   position_x: 19                          |           |
      |   position_y: 1                           |           |
      |   options:                                |           |
      |     code: >-                              |           |
      |       module.exports = async (data) => ({ |           |
      |       role: data.$accountability.role,    |           |
      |       roles: data.$accountability.roles   |           |
      |       });                                 |           |
      | method: PATCH                             | code: 200 |+
      | path: /flows/<flow>                       |           |
      | payload:                                  |           |
      |   operation: <operation>                  |           |
    Then these requests get these responses:
      | request                     | response             |
      | as: trigger-<run>           | code: 200            |+
      | method: GET                 | body:                |
      | path: /flows/trigger/<flow> |   role: <child-role> |
      | eventually: true            |   roles:             |
      |                             |     - <parent-role>  |
      |                             |     - <child-role>   |
    And on postgres the requests ran these statements:
      | request | table  | select | insert | update | delete |
      | 1       | (none) | 0      | 0      | 0      | 0      |
