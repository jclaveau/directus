Feature: Comments are written one at a time or in batches, and notify who they mention

  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.
  - Mentioned users take no email notifications, so no mail is attempted.

  Scenario: a comment is posted, edited one by one and in batches, deleted
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /items/test_singular_comments |           |
      | payload:                            |           |
      |   name: edited-<run>                |           |
      | remember: entry                     |           |
    Then these requests get these responses:
      | request                              | response                               |
      | method: POST                         | code: 200                              |+
      | path: /comments                      | body:                                  |
      | query:                               |   data:                                |
      |   fields: id,collection,item,comment |     id: <remark>                       |
      | payload:                             |     collection: test_singular_comments |
      |   id: <remark>                       |     item: '<entry>'                    |
      |   collection: test_singular_comments |     comment: posted-<run>              |
      |   item: '<entry>'                    |                                        |
      |   comment: posted-<run>              |                                        |
      | method: PATCH                        | code: 200                              |+
      | path: /comments/<remark>             | body:                                  |
      | query:                               |   data:                                |
      |   fields: comment                    |     comment: one-<run>                 |
      | payload:                             |                                        |
      |   comment: one-<run>                 |                                        |
      | method: PATCH                        | code: 200                              |+
      | path: /comments                      | body:                                  |
      | query:                               |   data:                                |
      |   fields: comment                    |     - comment: batch-<run>             |
      | payload:                             |                                        |
      |   - id: <remark>                     |                                        |
      |     comment: batch-<run>             |                                        |
      | method: PATCH                        | code: 200                              |+
      | path: /comments                      | body:                                  |
      | query:                               |   data:                                |
      |   fields: comment                    |     - comment: queried-<run>           |
      | payload:                             |                                        |
      |   query:                             |                                        |
      |     filter:                          |                                        |
      |       comment:                       |                                        |
      |         _eq: batch-<run>             |                                        |
      |   data:                              |                                        |
      |     comment: queried-<run>           |                                        |
      | method: DELETE                       | code: 204                              |+
      | path: /comments/<remark>             |                                        |
      | method: GET                          | code: 200                              |+
      | path: /comments                      | body:                                  |
      | query:                               |   data: []                             |
      |   fields: id                         |                                        |
      |   filter[id][_eq]: <remark>          |                                        |

  Scenario: a comment notifies the user it mentions who may read its item
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_singular_comments      |           |
      | payload:                                 |           |
      |   name: mentioned-<run>                  |           |
      | remember: entry                          |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy>                    |           |
      |   name: reader-<run>                     |           |
      |   app_access: true                       |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_singular_comments |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   id: <reader>                           |           |
      |   email: reader-<run>@example.com        |           |
      |   email_notifications: false             |           |
      |   policies:                              |           |
      |     - policy: <reader-policy>            |           |
    Then these requests get these responses:
      | request                              | response                                 |
      | method: POST                         | code: 200                                |+
      | path: /comments                      |                                          |
      | payload:                             |                                          |
      |   collection: test_singular_comments |                                          |
      |   item: '<entry>'                    |                                          |
      |   comment: '@<reader> please look'   |                                          |
      | method: GET                          | code: 200                                |+
      | path: /notifications                 | body:                                    |
      | query:                               |   data:                                  |
      |   fields: subject,collection,item    |     - subject: >-                        |
      |   filter[recipient][_eq]: <reader>   |         You were mentioned in            |
      |                                      |         test_singular_comments           |
      |                                      |       collection: test_singular_comments |
      |                                      |       item: '<entry>'                    |

  Scenario: a comment notifies the user it mentions who cannot read users
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_singular_comments      |           |
      | payload:                                 |           |
      |   name: unread-users-<run>               |           |
      | remember: entry                          |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <author-policy>                    |           |
      |   name: author-<run>                     |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_singular_comments |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      |     - collection: directus_comments      |           |
      |       action: create                     |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      |     - collection: directus_comments      |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      |     - collection: directus_users         |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: author-<run>@example.com        |           |
      |   token: <author-token>                  |           |
      |   policies:                              |           |
      |     - policy: <author-policy>            |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy>                    |           |
      |   name: reader-<run>                     |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_singular_comments |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   id: <reader>                           |           |
      |   email: reader-<run>@example.com        |           |
      |   email_notifications: false             |           |
      |   policies:                              |           |
      |     - policy: <reader-policy>            |           |
    Then these requests get these responses:
      | request                              | response                                 |
      | as: <author-token>                   | code: 200                                |+
      | method: POST                         |                                          |
      | path: /comments                      |                                          |
      | payload:                             |                                          |
      |   collection: test_singular_comments |                                          |
      |   item: '<entry>'                    |                                          |
      |   comment: '@<reader> please look'   |                                          |
      | method: GET                          | code: 200                                |+
      | path: /notifications                 | body:                                    |
      | query:                               |   data:                                  |
      |   fields: subject,collection,item    |     - subject: >-                        |
      |   filter[recipient][_eq]: <reader>   |         You were mentioned in            |
      |                                      |         test_singular_comments           |
      |                                      |       collection: test_singular_comments |
      |                                      |       item: '<entry>'                    |

  Scenario: a comment does not notify a user its author cannot read
    Given these requests are sent:
      | request                                  | response  |
      | method: POST                             | code: 200 |+
      | path: /items/test_singular_comments      |           |
      | payload:                                 |           |
      |   name: unread-mention-<run>             |           |
      | remember: entry                          |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <author-policy>                    |           |
      |   name: author-<run>                     |           |
      |   app_access: false                      |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_singular_comments |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      |     - collection: directus_comments      |           |
      |       action: create                     |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      |     - collection: directus_comments      |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   email: author-<run>@example.com        |           |
      |   token: <author-token>                  |           |
      |   policies:                              |           |
      |     - policy: <author-policy>            |           |
      | method: POST                             | code: 200 |+
      | path: /policies                          |           |
      | payload:                                 |           |
      |   id: <reader-policy>                    |           |
      |   name: reader-<run>                     |           |
      |   app_access: true                       |           |
      |   admin_access: false                    |           |
      |   permissions:                           |           |
      |     - collection: test_singular_comments |           |
      |       action: read                       |           |
      |       fields:                            |           |
      |         - '*'                            |           |
      | method: POST                             | code: 200 |+
      | path: /users                             |           |
      | payload:                                 |           |
      |   id: <reader>                           |           |
      |   email: reader-<run>@example.com        |           |
      |   email_notifications: false             |           |
      |   policies:                              |           |
      |     - policy: <reader-policy>            |           |
    Then these requests get these responses:
      | request                              | response   |
      | as: <author-token>                   | code: 200  |+
      | method: POST                         |            |
      | path: /comments                      |            |
      | payload:                             |            |
      |   collection: test_singular_comments |            |
      |   item: '<entry>'                    |            |
      |   comment: '@<reader> please look'   |            |
      | method: GET                          | code: 200  |+
      | path: /notifications                 | body:      |
      | query:                               |   data: [] |
      |   fields: id                         |            |
      |   filter[recipient][_eq]: <reader>   |            |
