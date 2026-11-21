Feature: A role's users list adds memberships and drops the others

  - `directus_roles.users` lists the role's memberships (#746): a user listed
    on a role becomes a member, keeping the roles they held, and a user no
    longer listed loses only that membership. A new user listed is created
    as a member.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: the users list of a role adds memberships and drops the others
    Given these requests are sent:
      | request                      | response  |
      | method: POST                 | code: 200 |+
      | path: /roles                 |           |
      | payload:                     |           |
      |   id: <first-role>           |           |
      |   name: first-<run>          |           |
      | method: POST                 | code: 200 |+
      | path: /roles                 |           |
      | payload:                     |           |
      |   id: <second-role>          |           |
      |   name: second-<run>         |           |
      | method: POST                 | code: 200 |+
      | path: /users                 |           |
      | payload:                     |           |
      |   - id: <first-user>         |           |
      |     email: first-<run>@x.co  |           |
      |     roles:                   |           |
      |       - role: <first-role>   |           |
      |   - id: <second-user>        |           |
      |     email: second-<run>@x.co |           |
      |     roles:                   |           |
      |       - role: <first-role>   |           |
    Then these requests get these responses:
      | request                          | response                                     |
      | method: PATCH                    | code: 200                                    |+
      | path: /roles/<second-role>       |                                              |
      | payload:                         |                                              |
      |   users:                         |                                              |
      |     - user: <first-user>         |                                              |
      | method: GET                      | code: 200                                    |+
      | path: /roles                     | body:                                        |
      | query:                           |   data:                                      |
      |   fields: id,users.user.email    |     - id: <first-role>                       |
      |   sort: name                     |       users:                                 |
      |   filter[name][_contains]: <run> |         - user: { email: first-<run>@x.co }  |
      |   deep[users][_sort]: user.email |         - user: { email: second-<run>@x.co } |
      |                                  |     - id: <second-role>                      |
      |                                  |       users:                                 |
      |                                  |         - user: { email: first-<run>@x.co }  |
      | method: PATCH                    | code: 200                                    |+
      | path: /roles/<second-role>       |                                              |
      | payload:                         |                                              |
      |   users:                         |                                              |
      |     - user: <second-user>        |                                              |
      |     - user:                      |                                              |
      |         email: third-<run>@x.co  |                                              |
      | method: GET                      | code: 200                                    |+
      | path: /roles                     | body:                                        |
      | query:                           |   data:                                      |
      |   fields: id,users.user.email    |     - id: <first-role>                       |
      |   sort: name                     |       users:                                 |
      |   filter[name][_contains]: <run> |         - user: { email: first-<run>@x.co }  |
      |   deep[users][_sort]: user.email |         - user: { email: second-<run>@x.co } |
      |                                  |     - id: <second-role>                      |
      |                                  |       users:                                 |
      |                                  |         - user: { email: second-<run>@x.co } |
      |                                  |         - user: { email: third-<run>@x.co }  |
    And on postgres the requests ran these statements:
      | request | table                 | select | insert | update | delete |
      | 1       | directus_access       | 2      | 0      | 0      | 0      |
      | 1       | directus_activity     | 0      | 2      | 0      | 0      |
      | 1       | directus_revisions    | 0      | 1      | 0      | 0      |
      | 1       | directus_role_members | 4      | 1      | 0      | 0      |
      | 1       | directus_roles        | 5      | 0      | 0      | 0      |
      | 1       | directus_users        | 1      | 0      | 0      | 0      |
      | 2       | directus_access       | 2      | 0      | 0      | 0      |
      | 2       | directus_role_members | 2      | 0      | 0      | 0      |
      | 2       | directus_roles        | 2      | 0      | 0      | 0      |
      | 2       | directus_users        | 2      | 0      | 0      | 0      |
      | 3       | directus_access       | 3      | 0      | 0      | 0      |
      | 3       | directus_activity     | 0      | 4      | 0      | 0      |
      | 3       | directus_revisions    | 0      | 2      | 1      | 0      |
      | 3       | directus_role_members | 6      | 1      | 0      | 1      |
      | 3       | directus_roles        | 6      | 0      | 0      | 0      |
      | 3       | directus_users        | 3      | 1      | 0      | 0      |
      | 4       | directus_access       | 2      | 0      | 0      | 0      |
      | 4       | directus_role_members | 2      | 0      | 0      | 0      |
      | 4       | directus_roles        | 2      | 0      | 0      | 0      |
      | 4       | directus_users        | 2      | 0      | 0      | 0      |
