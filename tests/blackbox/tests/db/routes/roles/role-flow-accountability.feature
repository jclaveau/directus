Feature: A flow run sees the roles of the user who triggered it

  - A webhook flow hands its operations `$accountability`, whose
    `memberRoles` are the user's memberships and `roles` adds their chain,
    parent first. `role` is gone (#746, D10), which stored flow code such as
    the webhook flows migration 20240311A wrote may still read.
  - The `exec` operation answers the two values; the flow returns the last
    operation's data as the response body.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a webhook flow run reads the user's member roles and their chain
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
      |   roles:                                  |           |
      |     - role: <child-role>                  |           |
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
      |       memberRoles:                        |           |
      |       data.$accountability.memberRoles,   |           |
      |       roles: data.$accountability.roles   |           |
      |       });                                 |           |
      | method: PATCH                             | code: 200 |+
      | path: /flows/<flow>                       |           |
      | payload:                                  |           |
      |   operation: <operation>                  |           |
    Then these requests get these responses:
      | request                     | response            |
      | as: trigger-<run>           | code: 200           |+
      | method: GET                 | body:               |
      | path: /flows/trigger/<flow> |   memberRoles:      |
      | eventually: true            |     - <child-role>  |
      |                             |   roles:            |
      |                             |     - <parent-role> |
      |                             |     - <child-role>  |
    And on postgres the requests ran these statements:
      | request | table              | select | insert | update | delete |
      | 1       | directus_access    | 2      | 0      | 0      | 0      |
      | 1       | directus_activity  | 0      | 1      | 0      | 0      |
      | 1       | directus_revisions | 0      | 1      | 0      | 0      |
      | 1       | directus_roles     | 2      | 0      | 0      | 0      |
      | 1       | directus_users     | 1      | 0      | 0      | 0      |
