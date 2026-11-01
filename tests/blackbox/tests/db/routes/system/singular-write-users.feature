Feature: A single user is checked as it is created

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.

  Scenario: a user created with an invalid email is refused and not written
    Then these requests get these responses:
      | request                             | response                     |
      | method: POST                        | code: 400                    |+
      | path: /users                        | body:                        |
      | payload:                            |   errors:                    |
      |   first_name: sw-<run>              |     - message: >-            |
      |   email: not-an-email               |         Validation failed    |
      |                                     |         for field "email".   |
      |                                     |         Value has to be a    |
      |                                     |         valid email address. |
      | method: GET                         | code: 200                    |+
      | path: /users                        | body:                        |
      | query:                              |   data: []                   |
      |   fields: id                        |                              |
      |   filter[first_name][_eq]: sw-<run> |                              |

  Scenario: a user created with an email already taken is refused
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /users                     |           |
      | payload:                         |           |
      |   first_name: first-<run>        |           |
      |   email: taken-<run>@example.com |           |
    Then these requests get these responses:
      | request                                 | response                            |
      | method: POST                            | code: 400                           |+
      | path: /users                            | body:                               |
      | payload:                                |   errors:                           |
      |   first_name: second-<run>              |     - message: >-                   |
      |   email: TAKEN-<run>@example.com        |         Value                       |
      |                                         |         "[taken-<run>@example.com]" |
      |                                         |         for field "email" in        |
      |                                         |         collection                  |
      |                                         |         "directus_users" has        |
      |                                         |         to be unique.               |
      | method: GET                             | code: 200                           |+
      | path: /users                            | body:                               |
      | query:                                  |   data: []                          |
      |   fields: id                            |                                     |
      |   filter[first_name][_eq]: second-<run> |                                     |
