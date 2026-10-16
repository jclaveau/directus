Feature: A single share is created only for an item its sender may share

  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.

  Scenario: a share is created only for an item its sender may share
    Given these requests are sent:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /items/test_singular_shares      |           |
      | payload:                               |           |
      |   name: open-<run>                     |           |
      | remember: open                         |           |
      | method: POST                           | code: 200 |+
      | path: /items/test_singular_shares      |           |
      | payload:                               |           |
      |   name: closed-<run>                   |           |
      | remember: closed                       |           |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <sharer-policy>                  |           |
      |   name: sharer-<run>                   |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      |   permissions:                         |           |
      |     - collection: test_singular_shares |           |
      |       action: share                    |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      |       permissions:                     |           |
      |         name:                          |           |
      |           _eq: open-<run>              |           |
      |     - collection: directus_shares      |           |
      |       action: create                   |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      |     - collection: directus_shares      |           |
      |       action: read                     |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   email: sharer-<run>@example.com      |           |
      |   token: <sharer-token>                |           |
      |   policies:                            |           |
      |     - policy: <sharer-policy>          |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   email: stranger-<run>@example.com    |           |
      |   token: <stranger-token>              |           |
    Then these requests get these responses:
      | request                            | response                               |
      | as: <stranger-token>               | code: 403                              |+
      | method: POST                       | body:                                  |
      | path: /shares                      |   errors:                              |
      | payload:                           |     - message: >-                      |
      |   collection: test_singular_shares |         You don't have permission to   |
      |   item: '<open>'                   |         access collection              |
      |                                    |         "test_singular_shares"         |
      |                                    |         or it does not exist. Queried  |
      |                                    |         in root.                       |
      | as: <sharer-token>                 | code: 403                              |+
      | method: POST                       | body:                                  |
      | path: /shares                      |   errors:                              |
      | payload:                           |     - message: >-                      |
      |   collection: test_singular_shares |         You don't have permission to   |
      |   item: '<closed>'                 |         perform "share" for collection |
      |                                    |         "test_singular_shares"         |
      |                                    |         or it does not exist.          |
      | as: <sharer-token>                 | code: 200                              |+
      | method: POST                       | body:                                  |
      | path: /shares                      |   data:                                |
      | query:                             |     collection: >-                     |
      |   fields: collection,item          |       test_singular_shares             |
      | payload:                           |     item: '<open>'                     |
      |   collection: test_singular_shares |                                        |
      |   item: '<open>'                   |                                        |

  Scenario: the admin shares any item of a collection that exists
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_singular_shares |           |
      | payload:                          |           |
      |   name: any-<run>                 |           |
      | remember: any                     |           |
    Then these requests get these responses:
      | request                             | response                             |
      | method: POST                        | code: 200                            |+
      | path: /shares                       | body:                                |
      | query:                              |   data:                              |
      |   fields: collection,item           |     collection: >-                   |
      | payload:                            |       test_singular_shares           |
      |   collection: test_singular_shares  |     item: '<any>'                    |
      |   item: '<any>'                     |                                      |
      | method: POST                        | code: 403                            |+
      | path: /shares                       | body:                                |
      | payload:                            |   errors:                            |
      |   collection: test_singular_missing |     - message: >-                    |
      |   item: '<any>'                     |         You don't have permission to |
      |                                     |         "share" from collection      |
      |                                     |         "test_singular_missing" or   |
      |                                     |         it does not exist.           |

  Scenario: a share is renamed one by one and in batches, then deleted
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /items/test_singular_shares  |           |
      | payload:                           |           |
      |   name: renamed-<run>              |           |
      | remember: renamed                  |           |
      | method: POST                       | code: 200 |+
      | path: /shares                      |           |
      | payload:                           |           |
      |   id: <share>                      |           |
      |   name: created-<run>              |           |
      |   collection: test_singular_shares |           |
      |   item: '<renamed>'                |           |
    Then these requests get these responses:
      | request                    | response                |
      | method: PATCH              | code: 200               |+
      | path: /shares/<share>      | body:                   |
      | query:                     |   data:                 |
      |   fields: name             |     name: one-<run>     |
      | payload:                   |                         |
      |   name: one-<run>          |                         |
      | method: PATCH              | code: 200               |+
      | path: /shares              | body:                   |
      | query:                     |   data:                 |
      |   fields: name             |     - name: batch-<run> |
      | payload:                   |                         |
      |   - id: <share>            |                         |
      |     name: batch-<run>      |                         |
      | method: PATCH              | code: 200               |+
      | path: /shares              | body:                   |
      | query:                     |   data:                 |
      |   fields: name,max_uses    |     - name: batch-<run> |
      | payload:                   |       max_uses: 3       |
      |   query:                   |                         |
      |     filter:                |                         |
      |       name:                |                         |
      |         _eq: batch-<run>   |                         |
      |   data:                    |                         |
      |     max_uses: 3            |                         |
      | method: DELETE             | code: 204               |+
      | path: /shares/<share>      |                         |
      | method: GET                | code: 200               |+
      | path: /shares              | body:                   |
      | query:                     |   data: []              |
      |   fields: id               |                         |
      |   filter[id][_eq]: <share> |                         |

  Scenario: a batch of shares is checked share by share like a single one
    Given these requests are sent:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /items/test_singular_shares      |           |
      | payload:                               |           |
      |   name: open-<run>                     |           |
      | remember: open                         |           |
      | method: POST                           | code: 200 |+
      | path: /items/test_singular_shares      |           |
      | payload:                               |           |
      |   name: closed-<run>                   |           |
      | remember: closed                       |           |
      | method: POST                           | code: 200 |+
      | path: /policies                        |           |
      | payload:                               |           |
      |   id: <sharer-policy>                  |           |
      |   name: sharer-<run>                   |           |
      |   app_access: false                    |           |
      |   admin_access: false                  |           |
      |   permissions:                         |           |
      |     - collection: test_singular_shares |           |
      |       action: share                    |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      |       permissions:                     |           |
      |         name:                          |           |
      |           _eq: open-<run>              |           |
      |     - collection: directus_shares      |           |
      |       action: create                   |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      |     - collection: directus_shares      |           |
      |       action: read                     |           |
      |       fields:                          |           |
      |         - '*'                          |           |
      | method: POST                           | code: 200 |+
      | path: /users                           |           |
      | payload:                               |           |
      |   email: sharer-<run>@example.com      |           |
      |   token: <sharer-token>                |           |
      |   policies:                            |           |
      |     - policy: <sharer-policy>          |           |
    Then these requests get these responses:
      | request                                | response                               |
      | as: <sharer-token>                     | code: 403                              |+
      | method: POST                           | body:                                  |
      | path: /shares                          |   errors:                              |
      | payload:                               |     - message: >-                      |
      |   - collection: test_singular_shares   |         You don't have permission to   |
      |     item: '<open>'                     |         perform "share" for collection |
      |   - collection: test_singular_shares   |         "test_singular_shares"         |
      |     item: '<closed>'                   |         or it does not exist.          |
      | method: GET                            | code: 200                              |+
      | path: /shares                          | body:                                  |
      | query:                                 |   data: []                             |
      |   fields: id                           |                                        |
      |   filter[item][_in]: '<open>,<closed>' |                                        |
      | as: <sharer-token>                     | code: 200                              |+
      | method: POST                           | body:                                  |
      | path: /shares                          |   data:                                |
      | query:                                 |     - item: '<open>'                   |
      |   fields: item                         |     - item: '<open>'                   |
      | payload:                               |                                        |
      |   - collection: test_singular_shares   |                                        |
      |     item: '<open>'                     |                                        |
      |   - collection: test_singular_shares   |                                        |
      |     item: '<open>'                     |                                        |
