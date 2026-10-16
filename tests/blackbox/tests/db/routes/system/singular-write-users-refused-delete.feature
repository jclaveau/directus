Feature: A refused user delete leaves the user's references as they were

  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.
  - The recipient takes no email notifications, so no mail is attempted.

  Scenario: a user deleted without the delete permission keeps sending
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <deleter-policy>             |           |
      |   name: deleter-<run>              |           |
      |   app_access: false                |           |
      |   admin_access: false              |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   id: <deleter>                    |           |
      |   email: deleter-<run>@example.com |           |
      |   token: <deleter-token>           |           |
      |   policies:                        |           |
      |     - policy: <deleter-policy>     |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   id: <sender>                     |           |
      |   email: sender-<run>@example.com  |           |
      |   email_notifications: false       |           |
      | method: POST                       | code: 200 |+
      | path: /notifications               |           |
      | payload:                           |           |
      |   recipient: <sender>              |           |
      |   sender: <sender>                 |           |
      |   subject: kept-<run>              |           |
      | remember: notice                   |           |
    Then these requests get these responses:
      | request                       | response                          |
      | as: <deleter-token>           | code: 403                         |+
      | method: DELETE                | body:                             |
      | path: /users/<sender>         |   errors:                         |
      |                               |     - message: >-                 |
      |                               |         You don't have permission |
      |                               |         to access collection      |
      |                               |         "directus_users" or it    |
      |                               |         does not exist. Queried   |
      |                               |         in root.                  |
      | method: GET                   | code: 200                         |+
      | path: /notifications/<notice> | body:                             |
      | query:                        |   data:                           |
      |   fields: sender              |     sender: <sender>              |
