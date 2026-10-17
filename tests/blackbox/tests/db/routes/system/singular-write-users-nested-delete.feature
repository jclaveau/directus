Feature: A user is deleted through a nested write on a related item

  - `test_sw_user_teams` holds the users whose `sw_user_team` names it, as
    `members`; a member taken out of a team is deleted. The feature adds
    `sw_user_team` to every user and drops it once its scenarios ran.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own, or for the key
    a `remember: name` row stored. A response cell states the keys it checks.

  Scenario: a member deleted from a team deletes the user
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_sw_user_teams   |           |
      | payload: {}                       |           |
      | remember: team                    |           |
      | method: POST                      | code: 200 |+
      | path: /users                      |           |
      | payload:                          |           |
      |   id: <member>                    |           |
      |   email: member-<run>@example.com |           |
      |   sw_user_team: <team>            |           |
    Then these requests get these responses:
      | request                                | response   |
      | method: PATCH                          | code: 200  |+
      | path: /items/test_sw_user_teams/<team> |            |
      | payload:                               |            |
      |   members:                             |            |
      |     delete:                            |            |
      |       - <member>                       |            |
      | method: GET                            | code: 200  |+
      | path: /users                           | body:      |
      | query:                                 |   data: [] |
      |   fields: id                           |            |
      |   filter[id][_eq]: <member>            |            |
