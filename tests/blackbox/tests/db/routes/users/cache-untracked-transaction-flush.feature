Feature: A role an extension writes in its own transaction flushes once it commits

  - The feature runs against an instance of its own with the response cache
    on, in memory, and `CACHE_AUTO_PURGE` off: only a write that changes
    rights, such as a user's role, flushes it.
  - `POST /untracked-trx-write/move-user` opens a transaction with
    the extension's own `database.transaction()`, writes the user's role
    through `UsersService`, then sends the `read` as that user
    before it commits, and answers with what that read got.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a read before the commit leaves no stale entry behind
    Given these requests are sent:
      | request                                 | response  |
      | method: POST                            | code: 200 |+
      | path: /collections                      |           |
      | payload:                                |           |
      |   collection: cache_untracked_notes     |           |
      |   schema: {}                            |           |
      |   meta: {}                              |           |
      |   fields:                               |           |
      |     - field: label                      |           |
      |       type: string                      |           |
      |       meta: {}                          |           |
      | method: POST                            | code: 200 |+
      | path: /items/cache_untracked_notes      |           |
      | payload:                                |           |
      |   label: v1                             |           |
      | method: POST                            | code: 200 |+
      | path: /policies                         |           |
      | payload:                                |           |
      |   id: <reader-policy>                   |           |
      |   name: reader-<run>                    |           |
      |   app_access: false                     |           |
      |   admin_access: false                   |           |
      |   permissions:                          |           |
      |     - collection: cache_untracked_notes |           |
      |       action: read                      |           |
      |       fields: ['*']                     |           |
      | method: POST                            | code: 200 |+
      | path: /roles                            |           |
      | payload:                                |           |
      |   id: <reader-role>                     |           |
      |   name: reader-<run>                    |           |
      |   policies:                             |           |
      |     - policy: <reader-policy>           |           |
      | method: POST                            | code: 200 |+
      | path: /roles                            |           |
      | payload:                                |           |
      |   id: <outsider-role>                   |           |
      |   name: outsider-<run>                  |           |
      | method: POST                            | code: 200 |+
      | path: /users                            |           |
      | payload:                                |           |
      |   id: <mover>                           |           |
      |   email: mover-<run>@example.com        |           |
      |   role: <reader-role>                   |           |
      |   token: mover-<run>                    |           |
    Then these requests get these responses:
      | request                                | response                        |
      | as: mover-<run>                        | code: 200                       |+
      | method: GET                            | headers:                        |
      | path: /items/cache_untracked_notes     |   x-cache-status: MISS          |
      | query:                                 | body:                           |
      |   fields: label                        |   data:                         |
      |                                        |     - label: v1                 |
      | method: POST                           | code: 200                       |+
      | path: /untracked-trx-write/move-user   | body:                           |
      | payload:                               |   readBeforeCommit:             |
      |   user: <mover>                        |     status: 200                 |
      |   role: <outsider-role>                |     cacheStatus: HIT            |
      |   read:                                |                                 |
      |     path: /items/cache_untracked_notes |                                 |
      |     query:                             |                                 |
      |       fields: label                    |                                 |
      |     token: mover-<run>                 |                                 |
      | as: mover-<run>                        | code: 403                       |+
      | method: GET                            | body:                           |
      | path: /items/cache_untracked_notes     |   errors:                       |
      | query:                                 |     - message: >-               |
      |   fields: label                        |         You don't have          |
      |                                        |         permission to access    |
      |                                        |         collection              |
      |                                        |         "cache_untracked_notes" |
      |                                        |         or it does not exist.   |
      |                                        |         Queried in root.        |
