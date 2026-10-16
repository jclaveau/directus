Feature: A user is invited, re-invited and accepts the invitation

  - The invitation mail is sent without being awaited, so a scenario reads
    the user it writes, never the mail.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    token it mails.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: an invited user takes the role of their latest invitation
    Given these requests are sent:
      | request              | response  |
      | method: POST         | code: 200 |+
      | path: /roles         |           |
      | payload:             |           |
      |   id: <first-role>   |           |
      |   name: first-<run>  |           |
      | method: POST         | code: 200 |+
      | path: /roles         |           |
      | payload:             |           |
      |   id: <second-role>  |           |
      |   name: second-<run> |           |
    Then these requests get these responses:
      | request                            | response                  |
      | method: POST                       | code: 204                 |+
      | path: /users/invite                |                           |
      | payload:                           |                           |
      |   email: invited-<run>@example.com |                           |
      |   role: <first-role>               |                           |
      | method: GET                        | code: 200                 |+
      | path: /users                       | body:                     |
      | query:                             |   data:                   |
      |   fields: status,role              |     - status: invited     |
      |   filter[email][_eq]: >-           |       role: <first-role>  |
      |     invited-<run>@example.com      |                           |
      | method: POST                       | code: 204                 |+
      | path: /users/invite                |                           |
      | payload:                           |                           |
      |   email: invited-<run>@example.com |                           |
      |   role: <second-role>              |                           |
      | method: GET                        | code: 200                 |+
      | path: /users                       | body:                     |
      | query:                             |   data:                   |
      |   fields: status,role              |     - status: invited     |
      |   filter[email][_eq]: >-           |       role: <second-role> |
      |     invited-<run>@example.com      |                           |

  Scenario: an invitation accepted with its token activates the user
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <invitee-role>                 |           |
      |   name: invitee-<run>                |           |
      | method: POST                         | code: 204 |+
      | path: /users/invite                  |           |
      | payload:                             |           |
      |   email: accepting-<run>@example.com |           |
      |   role: <invitee-role>               |           |
    Then these requests get these responses:
      | request                                | response                     |
      | method: POST                           | code: 204                    |+
      | path: /users/invite/accept             |                              |
      | payload:                               |                              |
      |   token: !jwt                          |                              |
      |     email: accepting-<run>@example.com |                              |
      |     scope: invite                      |                              |
      |   password: accepted-password          |                              |
      | method: GET                            | code: 200                    |+
      | path: /users                           | body:                        |
      | query:                                 |   data:                      |
      |   fields: status,password              |     - status: active         |
      |   filter[email][_eq]: >-               |       password: '**********' |
      |     accepting-<run>@example.com        |                              |
      | method: POST                           | code: 200                    |+
      | path: /auth/login                      |                              |
      | payload:                               |                              |
      |   email: accepting-<run>@example.com   |                              |
      |   password: accepted-password          |                              |

  Scenario: an invitation token is refused for another scope or a user not invited
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /users                      |           |
      | payload:                          |           |
      |   email: active-<run>@example.com |           |
    Then these requests get these responses:
      | request                             | response                                |
      | method: POST                        | code: 403                               |+
      | path: /users/invite/accept          | body:                                   |
      | payload:                            |   errors:                               |
      |   token: !jwt                       |     - message: Not an invite token      |
      |     email: active-<run>@example.com |                                         |
      |     scope: password-reset           |                                         |
      |   password: accepted-password       |                                         |
      | method: POST                        | code: 400                               |+
      | path: /users/invite/accept          | body:                                   |
      | payload:                            |   errors:                               |
      |   token: !jwt                       |     - message: >-                       |
      |     email: active-<run>@example.com |         Invalid payload. Email address  |
      |     scope: invite                   |         active-<run>@example.com hasn't |
      |   password: accepted-password       |         been invited.                   |
      | method: GET                         | code: 200                               |+
      | path: /users                        | body:                                   |
      | query:                              |   data:                                 |
      |   fields: status,password           |     - status: active                    |
      |   filter[email][_eq]: >-            |       password: null                    |
      |     active-<run>@example.com        |                                         |

  Scenario: an invitation to a URL off the allow list creates no user
    Given these requests are sent:
      | request               | response  |
      | method: POST          | code: 200 |+
      | path: /roles          |           |
      | payload:              |           |
      |   id: <refused-role>  |           |
      |   name: refused-<run> |           |
    Then these requests get these responses:
      | request                            | response                                |
      | method: POST                       | code: 400                               |+
      | path: /users/invite                | body:                                   |
      | payload:                           |   errors:                               |
      |   email: refused-<run>@example.com |     - message: >-                       |
      |   role: <refused-role>             |         Invalid payload. URL            |
      |   invite_url: >-                   |         "https://elsewhere.test/accept" |
      |     https://elsewhere.test/accept  |         can't be used to invite users.  |
      | method: GET                        | code: 200                               |+
      | path: /users                       | body:                                   |
      | query:                             |   data: []                              |
      |   fields: id                       |                                         |
      |   filter[email][_eq]: >-           |                                         |
      |     refused-<run>@example.com      |                                         |

  Scenario: a user invited again to a URL off the allow list is refused
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /roles                     |           |
      | payload:                         |           |
      |   id: <again-role>               |           |
      |   name: again-<run>              |           |
      | method: POST                     | code: 204 |+
      | path: /users/invite              |           |
      | payload:                         |           |
      |   email: again-<run>@example.com |           |
      |   role: <again-role>             |           |
      | method: POST                     | code: 200 |+
      | path: /users                     |           |
      | payload:                         |           |
      |   email: known-<run>@example.com |           |
    Then these requests get these responses:
      | request                           | response                                |
      | method: POST                      | code: 400                               |+
      | path: /users/invite               | body:                                   |
      | payload:                          |   errors:                               |
      |   email: again-<run>@example.com  |     - message: >-                       |
      |   role: <again-role>              |         Invalid payload. URL            |
      |   invite_url: >-                  |         "https://elsewhere.test/accept" |
      |     https://elsewhere.test/accept |         can't be used to invite users.  |
      | method: POST                      | code: 400                               |+
      | path: /users/invite               | body:                                   |
      | payload:                          |   errors:                               |
      |   email: known-<run>@example.com  |     - message: >-                       |
      |   role: <again-role>              |         Invalid payload. URL            |
      |   invite_url: >-                  |         "https://elsewhere.test/accept" |
      |     https://elsewhere.test/accept |         can't be used to invite users.  |
