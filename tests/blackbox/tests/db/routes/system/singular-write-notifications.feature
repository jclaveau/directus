Feature: Notifications are written one at a time or in batches

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own, or for the key
    a `remember: name` row stored. A response cell states the keys it checks.
  - The recipient takes no email notifications, so no mail is attempted.

  Scenario: a notification is sent, archived one by one and in batches, deleted
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   id: <recipient>                    |           |
      |   email: recipient-<run>@example.com |           |
      |   email_notifications: false         |           |
    Then these requests get these responses:
      | request                               | response                   |
      | method: POST                          | code: 200                  |+
      | path: /notifications                  | body:                      |
      | query:                                |   data:                    |
      |   fields: id,recipient,subject,status |     recipient: <recipient> |
      | payload:                              |     subject: sent-<run>    |
      |   recipient: <recipient>              |     status: inbox          |
      |   subject: sent-<run>                 |                            |
      | remember: notice                      |                            |
      | method: PATCH                         | code: 200                  |+
      | path: /notifications/<notice>         | body:                      |
      | query:                                |   data:                    |
      |   fields: subject                     |     subject: one-<run>     |
      | payload:                              |                            |
      |   subject: one-<run>                  |                            |
      | method: PATCH                         | code: 200                  |+
      | path: /notifications                  | body:                      |
      | query:                                |   data:                    |
      |   fields: subject                     |     - subject: batch-<run> |
      | payload:                              |                            |
      |   - id: <notice>                      |                            |
      |     subject: batch-<run>              |                            |
      | method: PATCH                         | code: 200                  |+
      | path: /notifications                  | body:                      |
      | query:                                |   data:                    |
      |   fields: subject,status              |     - subject: batch-<run> |
      | payload:                              |       status: archived     |
      |   query:                              |                            |
      |     filter:                           |                            |
      |       recipient:                      |                            |
      |         _eq: <recipient>              |                            |
      |   data:                               |                            |
      |     status: archived                  |                            |
      | method: DELETE                        | code: 204                  |+
      | path: /notifications/<notice>         |                            |
      | method: GET                           | code: 200                  |+
      | path: /notifications                  | body:                      |
      | query:                                |   data: []                 |
      |   fields: id                          |                            |
      |   filter[recipient][_eq]: <recipient> |                            |
