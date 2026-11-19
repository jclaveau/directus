Feature: An asset is cached publicly with no role, privately with one

  - Pins today's single-role contract (#746). The `Cache-Control` of an asset
    tells shared caches they may keep it (`public`) when the request has no
    role, even from a logged-in user whose policies are given to them
    directly, and only the browser may (`private`) when it has one.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.

  Scenario: an asset is public to a user with no role, private to a role
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /files                         |           |
      | form:                                |           |
      |   title: cached-<run>                |           |
      | file:                                |           |
      |   name: cached-<run>.txt             |           |
      |   content: cached                    |           |
      | remember: cached                     |           |
      | method: POST                         | code: 200 |+
      | path: /policies                      |           |
      | payload:                             |           |
      |   id: <file-reader-policy>           |           |
      |   name: file-reader-<run>            |           |
      |   app_access: false                  |           |
      |   admin_access: false                |           |
      |   permissions:                       |           |
      |     - collection: directus_files     |           |
      |       action: read                   |           |
      |       fields: ['*']                  |           |
      | method: POST                         | code: 200 |+
      | path: /roles                         |           |
      | payload:                             |           |
      |   id: <reader-role>                  |           |
      |   name: reader-<run>                 |           |
      |   policies:                          |           |
      |     - policy: <file-reader-policy>   |           |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   - email: no-role-<run>@example.com |           |
      |     token: no-role-<run>             |           |
      |     policies:                        |           |
      |       - policy: <file-reader-policy> |           |
      |   - email: in-role-<run>@example.com |           |
      |     token: in-role-<run>             |           |
      |     role: <reader-role>              |           |
    Then these requests get these responses:
      | request                | response                                  |
      | as: no-role-<run>      | code: 200                                 |+
      | method: GET            | headers:                                  |
      | path: /assets/<cached> |   cache-control: public, max-age=2592000  |
      | as: in-role-<run>      | code: 200                                 |+
      | method: GET            | headers:                                  |
      | path: /assets/<cached> |   cache-control: private, max-age=2592000 |
    And on postgres the requests ran these statements:
      | request | table  | select | insert | update | delete |
      | 1       | (none) | 0      | 0      | 0      | 0      |
      | 2       | (none) | 0      | 0      | 0      | 0      |
